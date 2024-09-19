from flask import Flask, request, jsonify

app = Flask(__name__)

# Endpoint to receive success notifications
@app.route('/success', methods=['PUT'])
def handle_success():
    data = request.json
    print("Received success notification:")
    print(data)
    return jsonify({"status": "success received"}), 200

# Endpoint to receive failure notifications
@app.route('/failure', methods=['PUT'])
def handle_failure():
    data = request.json
    print("Received failure notification:")
    print(data)
    return jsonify({"status": "failure received"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
