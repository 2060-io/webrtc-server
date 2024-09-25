from flask import Flask, jsonify, request
import os
import asyncio
import threading
import requests
from mediasoup import Demo  
from urllib.parse import urlparse, parse_qs
from aiortc.contrib.media import MediaPlayer, MediaBlackhole
import subprocess

def get_video_duration(video_url):
    result = subprocess.run([
        'ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video_url
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return float(result.stdout)

app = Flask(__name__)

# Environment variable for default video source URL
DEFAULT_VIDEO_SRC_URL = os.getenv('DEFAULT_VIDEO_SRC_URL', 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4')
PORT= os.getenv('PORT',5000)

def run_demo(ws_url, success_url, failure_url):
    player = MediaPlayer(DEFAULT_VIDEO_SRC_URL)
    recorder = MediaBlackhole()
    
    video_duration = get_video_duration(DEFAULT_VIDEO_SRC_URL)

    print('*** video duration: ', video_duration)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    print('**** ws_url:', ws_url)
    try:
        # Execute the Demo logic using asyncio
        demo = Demo(uri=ws_url, player=player, recorder=recorder, loop=loop, time=video_duration + 5)
        result = loop.run_until_complete(demo.run())
        
        # Notify success_url if provided
        if success_url:
            requests.put(success_url, json={"status": "success"})
        
        print('Demo completed successfully.')
    except Exception as e:
        # Notify failure_url if provided
        if failure_url:
            requests.put(failure_url, json={"status": "failure"})        
        print(f'Error during demo execution: {str(e)}')

@app.route('/join-call', methods=['POST'])
def join_call():
    data = request.json
    ws_url = data.get('ws_url')
    success_url = data.get('success_url')
    failure_url = data.get('failure_url')

    if not ws_url:
        return jsonify(error="ws_url parameter is required"), 400

   
    
    # Run demo in a separate thread
    thread = threading.Thread(target=run_demo, args=(ws_url, success_url, failure_url))
    thread.start()
    
    return jsonify(status="success"), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
