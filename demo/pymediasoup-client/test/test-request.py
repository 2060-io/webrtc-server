import requests
import time

# URL of the /join-call endpoint
url = 'http://localhost:5000/join-call'

# Data to be sent with the POST request
data = {
    'ws_url': 'wss://dts-webrtc.dev.2060.io:443/?roomId=l9e6k3mb&peerId=123456',  # Replace with your actual WebSocket URL
    'success_url': 'http://192.168.10.10:5001/success',  # Replace with your actual success URL
    'failure_url': 'http://192.168.10.10:5001/failure'  # Replace with your actual failure URL
}

# Function to make a POST request to /join-call
def test_join_call():
    try:
        response = requests.post(url, json=data)
        print(f'Response Status Code: {response.status_code}')
        print(f'Response Content: {response.text}')
    except Exception as e:
        print(f'Error making request: {e}')

# Run the test every 20 seconds
while True:
    test_join_call()
    time.sleep(20)
