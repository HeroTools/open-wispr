#!/usr/bin/env python3
"""
Whisper Bridge Script for OpenWispr
Handles local speech-to-text processing using OpenAI's Whisper model
"""

import sys
import json
import tempfile
import os
import argparse
from pathlib import Path
import whisper
import threading
import time
import requests
import gc

def get_ffmpeg_path():
    """Get path to bundled FFmpeg executable with proper production support"""
    
    # Check environment variables first (set by Node.js)
    env_paths = [
        os.environ.get("FFMPEG_PATH"),
        os.environ.get("FFMPEG_EXECUTABLE"), 
        os.environ.get("FFMPEG_BINARY")
    ]
    
    for env_path in env_paths:
        if env_path and os.path.exists(env_path):
            return env_path
    
    # Determine base path
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
    
    # Try multiple possible paths for production Electron app
    possible_paths = []
    
    if sys.platform == "darwin":  # macOS
        possible_paths = [
            # Unpacked ASAR locations
            os.path.join(base_path, "..", "..", "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
            os.path.join(base_path, "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
            # Development path
            os.path.join(base_path, "..", "node_modules", "ffmpeg-static", "ffmpeg"),
        ]
    elif sys.platform == "win32":  # Windows
        possible_paths = [
            os.path.join(base_path, "..", "..", "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
            os.path.join(base_path, "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
            os.path.join(base_path, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"),
        ]
    else:  # Linux
        possible_paths = [
            os.path.join(base_path, "..", "..", "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
            os.path.join(base_path, "..", "app.asar.unpacked", "node_modules", "ffmpeg-static", "ffmpeg"),
            os.path.join(base_path, "..", "node_modules", "ffmpeg-static", "ffmpeg"),
        ]
    
    # Try each possible path
    for ffmpeg_path in possible_paths:
        abs_path = os.path.abspath(ffmpeg_path)
        if os.path.exists(abs_path) and os.access(abs_path, os.X_OK):
            return abs_path
    
    return None

# Set FFmpeg path for Whisper
ffmpeg_path = get_ffmpeg_path()
if ffmpeg_path:
    os.environ["FFMPEG_BINARY"] = ffmpeg_path

# Global model cache to avoid reloading
_model_cache = {}

def load_model(model_name="base"):
    """Load Whisper model with caching for performance"""
    global _model_cache
    
    # Return cached model if available
    if model_name in _model_cache:
        return _model_cache[model_name]
    
    try:
        model = whisper.load_model(model_name)
        
        # Cache the model but limit cache size
        if len(_model_cache) >= 2:  # Keep max 2 models in memory
            # Remove oldest model
            oldest_key = next(iter(_model_cache))
            del _model_cache[oldest_key]
            gc.collect()  # Force garbage collection
        
        _model_cache[model_name] = model
        return model
    except Exception as e:
        return None

def get_expected_model_size(model_name):
    """Get expected file size for a model by checking the remote URL"""
    try:
        model_url = whisper._MODELS[model_name]
        response = requests.head(model_url, timeout=10)
        if response.status_code == 200:
            content_length = response.headers.get('content-length')
            if content_length:
                return int(content_length)
    except Exception:
        pass
    
    # Fallback to approximate sizes (in bytes)
    approximate_sizes = {
        "tiny": 39 * 1024 * 1024,     # ~39MB
        "base": 74 * 1024 * 1024,     # ~74MB
        "small": 244 * 1024 * 1024,   # ~244MB
        "medium": 769 * 1024 * 1024,  # ~769MB
        "large": 1550 * 1024 * 1024,  # ~1550MB
        "turbo": 809 * 1024 * 1024    # ~809MB
    }
    return approximate_sizes.get(model_name, 100 * 1024 * 1024)  # Default 100MB

def monitor_download_progress(model_name, expected_size, stop_event):
    """Monitor download progress by watching file size growth"""
    cache_dir = os.path.expanduser("~/.cache/whisper")
    model_url = whisper._MODELS[model_name]
    model_file = os.path.join(cache_dir, os.path.basename(model_url))
    
    os.makedirs(cache_dir, exist_ok=True)
    
    last_size = 0
    last_update_time = time.time()
    speed_samples = []
    last_progress_update = 0
    
    while not stop_event.is_set():
        try:
            current_size = 0
            if os.path.exists(model_file):
                current_size = os.path.getsize(model_file)
            
            current_time = time.time()
            time_diff = current_time - last_update_time
            
            # Calculate speed if we have a previous measurement
            speed_mbps = 0
            if last_size > 0 and time_diff > 0 and current_size > last_size:
                bytes_per_second = (current_size - last_size) / time_diff
                speed_mbps = (bytes_per_second * 8) / (1024 * 1024)  # Convert to Mbps
                
                # Keep rolling average of speed samples
                speed_samples.append(speed_mbps)
                if len(speed_samples) > 10:  # Keep last 10 samples
                    speed_samples.pop(0)
                speed_mbps = sum(speed_samples) / len(speed_samples)
            
            # Send progress update (throttled to avoid spam)
            percentage = min((current_size / expected_size * 100) if expected_size > 0 else 0, 100)
            
            # Only send progress updates every 0.5 seconds or when percentage changes significantly
            if (current_time - last_progress_update > 0.5 or 
                abs(percentage - last_progress_update) > 1.0):
                
                progress_data = {
                    "type": "progress",
                    "model": model_name,
                    "downloaded_bytes": current_size,
                    "total_bytes": expected_size,
                    "percentage": round(percentage, 1),
                    "speed_mbps": round(speed_mbps, 2) if speed_mbps > 0 else 0
                }
                
                print(f"PROGRESS:{json.dumps(progress_data)}", file=sys.stderr)
                last_progress_update = percentage
            
            if current_size >= expected_size * 0.95:
                break
                
            if current_size == last_size and current_time - last_update_time > 10:
                if current_size > expected_size * 0.9:
                    break
                    
            last_size = current_size
            last_update_time = current_time
            
        except Exception:
            pass
            
        time.sleep(0.5)  # Check every 500ms

def download_model(model_name="base"):
    """Download Whisper model with real-time progress monitoring"""
    stop_event = threading.Event()
    progress_thread = None
    
    try:
        # Check if model is already downloaded
        cache_dir = os.path.expanduser("~/.cache/whisper")
        model_url = whisper._MODELS[model_name]
        model_file = os.path.join(cache_dir, os.path.basename(model_url))
        
        if os.path.exists(model_file):
            file_size = os.path.getsize(model_file)
            return {
                "model": model_name,
                "downloaded": True,
                "path": model_file,
                "size_bytes": file_size,
                "size_mb": round(file_size / (1024 * 1024), 1),
                "success": True
            }
        
        # Get expected file size
        expected_size = get_expected_model_size(model_name)
        
        # Start progress monitoring in background thread
        progress_thread = threading.Thread(
            target=monitor_download_progress, 
            args=(model_name, expected_size, stop_event),
            daemon=True
        )
        progress_thread.start()
        
        # Start the actual download (this will block until complete)
        model = whisper.load_model(model_name)
        
        # Stop progress monitoring
        stop_event.set()
        
        # Wait for progress thread to finish
        if progress_thread and progress_thread.is_alive():
            progress_thread.join(timeout=1)
        
        # Get final file info
        final_size = 0
        if os.path.exists(model_file):
            final_size = os.path.getsize(model_file)
        
        # Send completion signal
        completion_data = {
            "type": "complete",
            "model": model_name,
            "downloaded_bytes": final_size,
            "total_bytes": expected_size,
            "percentage": 100
        }
        print(f"PROGRESS:{json.dumps(completion_data)}", file=sys.stderr)
        
        return {
            "model": model_name,
            "downloaded": True,
            "path": model_file,
            "size_bytes": final_size,
            "size_mb": round(final_size / (1024 * 1024), 1),
            "success": True
        }
        
    except KeyboardInterrupt:
        stop_event.set()
        return {
            "model": model_name,
            "downloaded": False,
            "error": "Download interrupted by user",
            "success": False
        }
    except Exception as e:
        stop_event.set()
        return {
            "model": model_name,
            "downloaded": False,
            "error": str(e),
            "success": False
        }

def check_model_status(model_name="base"):
    """Check if a model is already downloaded"""
    try:
        cache_dir = os.path.expanduser("~/.cache/whisper")
        model_url = whisper._MODELS[model_name]
        model_file = os.path.join(cache_dir, os.path.basename(model_url))
        
        if os.path.exists(model_file):
            file_size = os.path.getsize(model_file)
            return {
                "model": model_name,
                "downloaded": True,
                "path": model_file,
                "size_bytes": file_size,
                "size_mb": round(file_size / (1024 * 1024), 1),
                "success": True
            }
        else:
            return {
                "model": model_name,
                "downloaded": False,
                "success": True
            }
    except Exception as e:
        return {
            "model": model_name,
            "error": str(e),
            "success": False
        }

def list_models():
    """List all available models and their download status"""
    models = ["tiny", "base", "small", "medium", "large", "turbo"]
    model_info = []
    
    for model in models:
        status = check_model_status(model)
        model_info.append(status)
    
    return {
        "models": model_info,
        "cache_dir": os.path.expanduser("~/.cache/whisper"),
        "success": True
    }

def delete_model(model_name="base"):
    """Delete a downloaded Whisper model"""
    try:
        cache_dir = os.path.expanduser("~/.cache/whisper")
        model_url = whisper._MODELS[model_name]
        model_file = os.path.join(cache_dir, os.path.basename(model_url))
        
        if os.path.exists(model_file):
            file_size = os.path.getsize(model_file)
            os.remove(model_file)
            return {
                "model": model_name,
                "deleted": True,
                "freed_bytes": file_size,
                "freed_mb": round(file_size / (1024 * 1024), 1),
                "success": True
            }
        else:
            return {
                "model": model_name,
                "deleted": False,
                "error": "Model not found",
                "success": False
            }
    except Exception as e:
        return {
            "model": model_name,
            "deleted": False,
            "error": str(e),
            "success": False
        }

def transcribe_audio(audio_path, model_name="base", language=None):
    """Transcribe audio file using Whisper with optimizations"""
    try:
        # Load model (uses cache for performance)
        model = load_model(model_name)
        if model is None:
            return {"error": "Failed to load Whisper model", "success": False}
        
        # Set transcription options - keep it simple for reliability
        options = {
            "fp16": False,  # Use FP32 for better compatibility
            "verbose": False,  # Reduce logging overhead
        }
        if language:
            options["language"] = language
            
        result = model.transcribe(audio_path, **options)
        
        # Return results - only JSON to stdout
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language", "unknown"),
            "success": True
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "success": False
        }

def check_ffmpeg():
    """Check if FFmpeg is available and working"""
    try:
        # Test FFmpeg by trying to get its version
        import subprocess
        result = subprocess.run([ffmpeg_path or "ffmpeg", "-version"], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            return {
                "available": True,
                "path": ffmpeg_path or "ffmpeg",
                "version": result.stdout.split('\n')[0] if result.stdout else "Unknown",
                "success": True
            }
        else:
            return {
                "available": False,
                "error": f"FFmpeg returned code {result.returncode}",
                "success": False
            }
    except subprocess.TimeoutExpired:
        return {
            "available": False,
            "error": "FFmpeg check timed out",
            "success": False
        }
    except FileNotFoundError:
        return {
            "available": False,
            "error": "FFmpeg not found in PATH",
            "success": False
        }
    except Exception as e:
        return {
            "available": False,
            "error": str(e),
            "success": False
        }

def main():
    parser = argparse.ArgumentParser(description="Whisper Bridge for OpenWispr")
    parser.add_argument("--mode", default="transcribe", 
                       choices=["transcribe", "download", "check", "list", "delete", "check-ffmpeg"],
                       help="Operation mode (default: transcribe)")
    parser.add_argument("audio_file", nargs="?", help="Path to audio file to transcribe")
    parser.add_argument("--model", default="base", 
                       choices=["tiny", "base", "small", "medium", "large", "turbo"],
                       help="Whisper model to use (default: base)")
    parser.add_argument("--language", help="Language code (optional)")
    parser.add_argument("--output-format", default="json", 
                       choices=["json", "text"],
                       help="Output format (default: json)")
    
    args = parser.parse_args()
    
    # Handle different modes
    if args.mode == "download":
        result = download_model(args.model)
        print(json.dumps(result))
        return
    elif args.mode == "check":
        result = check_model_status(args.model)
        print(json.dumps(result))
        return
    elif args.mode == "list":
        result = list_models()
        print(json.dumps(result))
        return
    elif args.mode == "delete":
        result = delete_model(args.model)
        print(json.dumps(result))
        return
    elif args.mode == "check-ffmpeg":
        result = check_ffmpeg()
        print(json.dumps(result))
        return
    elif args.mode == "transcribe":
        # Check if audio file exists
        if not args.audio_file:
            error_result = {"error": "Audio file required for transcription mode", "success": False}
            print(json.dumps(error_result))
            sys.exit(1)
            
        if not os.path.exists(args.audio_file):
            error_result = {"error": f"Audio file not found: {args.audio_file}", "success": False}
            print(json.dumps(error_result))
            sys.exit(1)
        
        # Transcribe
        result = transcribe_audio(args.audio_file, args.model, args.language)
        
        # Output results
        if args.output_format == "json":
            print(json.dumps(result))
        else:
            if result.get("success"):
                print(result.get("text", ""))
            else:
                print(f"Error: {result.get('error', 'Unknown error')}", file=sys.stderr)
                sys.exit(1)

if __name__ == "__main__":
    main()