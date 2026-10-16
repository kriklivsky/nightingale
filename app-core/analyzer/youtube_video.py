"""Bounded YouTube-only search/download worker; one JSON request and response."""

import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

MAX_BYTES = 512 * 1024 * 1024


class QuietLogger:
    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, _message):
        pass


def video_id(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{11}', value) is not None


def seconds(value):
    if isinstance(value, (float, int)) and math.isfinite(value) and 0 < value <= 1200:
        return float(value)
    return None


def text(value):
    return str(value or '').replace('\x00', '')[:300]


def decode(ffmpeg, source, target):
    result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-threads', '1', '-i', str(source),
                             '-t', '300', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le',
                             '-threads', '1', str(target)], stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    return result.returncode == 0


def run(request):
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError('YouTube downloader is unavailable. Install yt-dlp[default] in the Nightingale Python environment.') from error
    options = {'quiet': True, 'no_warnings': True, 'logger': QuietLogger(), 'noplaylist': True,
               'socket_timeout': 15, 'retries': 2, 'fragment_retries': 2,
               'cachedir': False, 'remote_components': [], 'js_runtimes': {'node': {}, 'deno': {}}}
    if request['action'] == 'search':
        query = request['query']
        if not isinstance(query, str) or not 1 <= len(query) <= 300:
            raise ValueError('Invalid YouTube search query')
        options['extract_flat'] = True
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info('ytsearch8:' + query, download=False)
        return {'candidates': [{'id': entry['id'], 'title': text(entry.get('title')),
                                'channel': text(entry.get('channel') or entry.get('uploader')),
                                'duration_sec': seconds(entry.get('duration'))}
                               for entry in (info or {}).get('entries', [])
                               if entry and video_id(entry.get('id')) and not entry.get('is_live')]}
    if request['action'] != 'download' or not video_id(request.get('video_id')):
        raise ValueError('Invalid YouTube video identifier')
    directory = Path(request['directory'])
    ffmpeg = request['ffmpeg']

    def check_progress(_progress):
        if sum(path.stat().st_size for path in directory.iterdir() if path.is_file()) > MAX_BYTES:
            raise RuntimeError('Video exceeds the 512 MiB download limit')

    def check_media(info, *, incomplete=False):
        duration = seconds(info.get('duration'))
        if info.get('is_live') or (not incomplete and duration is None):
            return 'Only finite videos up to 20 minutes are supported'
        return None

    options.update({'format': 'bestvideo[vcodec^=avc1][height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][height<=1080][ext=mp4]',
                    'outtmpl': str(directory / 'clip.%(ext)s'), 'merge_output_format': 'mp4',
                    'ffmpeg_location': ffmpeg, 'max_filesize': MAX_BYTES,
                    'progress_hooks': [check_progress], 'match_filter': check_media,
                    'concurrent_fragment_downloads': 1})
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info('https://www.youtube.com/watch?v=' + request['video_id'], download=True)
    clip = directory / 'clip.mp4'
    if not info or not clip.is_file() or not 0 < clip.stat().st_size <= MAX_BYTES:
        raise RuntimeError('No compatible H.264 video was downloaded')
    local_pcm, video_pcm = directory / 'song.f32', directory / 'video.f32'
    offset = None
    try:
        if decode(ffmpeg, request['audio_path'], local_pcm) and decode(ffmpeg, clip, video_pcm):
            from video_sync import find_offset
            offset = find_offset(local_pcm, video_pcm)
    except (subprocess.TimeoutExpired, ValueError):
        offset = None
    finally:
        for path in (local_pcm, video_pcm):
            path.unlink(missing_ok=True)
    return {'title': text(info.get('title')), 'offset_sec': offset}


if __name__ == '__main__':
    os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
    os.environ.setdefault('OMP_NUM_THREADS', '1')
    try:
        request = json.loads(sys.stdin.read(8193))
        response = run(request)
    except RuntimeError as error:
        response = {'error': str(error)}
    except Exception:
        response = {'error': 'YouTube request failed. The video may be unavailable, rate-limited, or require a newer downloader/JavaScript runtime.'}
    print(json.dumps(response, ensure_ascii=False), flush=True)
