import sys
import json
import asyncio
import argparse
import secrets
from typing import Optional, Dict, Awaitable, Any, TypeVar
from asyncio.futures import Future

from pymediasoup import Device
from pymediasoup import AiortcHandler
from pymediasoup.transport import Transport
from pymediasoup.consumer import Consumer
from pymediasoup.producer import Producer
from pymediasoup.data_consumer import DataConsumer
from pymediasoup.data_producer import DataProducer
from pymediasoup.sctp_parameters import SctpStreamParameters

# Import aiortc
from aiortc import VideoStreamTrack,RTCIceServer
from aiortc.mediastreams import AudioStreamTrack
from aiortc.contrib.media import MediaPlayer, MediaBlackhole, MediaRecorder

# Implement simple protoo client
import websockets
from random import random

T = TypeVar("T")


class Demo:
    def __init__(self, uri, player=None, recorder=None, loop=None, time=None):
        if not loop:
            if sys.version_info.major == 3 and sys.version_info.minor == 6:
                loop = asyncio.get_event_loop()
            else:
                loop = asyncio.get_running_loop()
        
        print('*** Uri:', uri)
        
        self._time = time
        self._loop = loop
        self._uri = uri
        self._player = player
        self._recorder = recorder

        # Save answers temporarily
        self._answers: Dict[str, Future] = {}
        self._websocket = None
        self._device = None

        self._tracks = []

        
        if player and player.audio:
            audioTrack = player.audio
        else:
            audioTrack = AudioStreamTrack()
        if player and player.video:
            videoTrack = player.video
        else:
            videoTrack = VideoStreamTrack()

        self._videoTrack = videoTrack
        self._audioTrack = audioTrack

        self._tracks.append(videoTrack)
        self._tracks.append(audioTrack)

        self._sendTransport: Optional[Transport] = None
        self._recvTransport: Optional[Transport] = None

        self._producers = []
        self._consumers = []
        self._tasks = []
        self._closed = False

    # websocket receive task
    async def recv_msg_task(self):
        while True:
            await asyncio.sleep(0.5)
            try:
                if self._websocket is not None:
                    message = json.loads(await self._websocket.recv())
                    if message.get("response"):
                        if message.get("id") is not None:
                            self._answers[message.get("id")].set_result(message)
                    elif message.get("request"):
                        if message.get("method") == "newConsumer":
                            await self.consume(
                                id=message["data"]["id"],
                                producerId=message["data"]["producerId"],
                                kind=message["data"]["kind"],
                                rtpParameters=message["data"]["rtpParameters"],
                            )
                            response = {
                                "response": True,
                                "id": message["id"],
                                "ok": True,
                                "data": {},
                            }
                            await self._websocket.send(json.dumps(response))
                        elif message.get("method") == "newDataConsumer":
                            await self.consumeData(
                                id=message["data"]["id"],
                                dataProducerId=message["data"]["dataProducerId"],
                                label=message["data"]["label"],
                                protocol=message["data"]["protocol"],
                                sctpStreamParameters=message["data"][
                                    "sctpStreamParameters"
                                ],
                            )
                            response = {
                                "response": True,
                                "id": message["data"]["id"],
                                "ok": True,
                                "data": {},
                            }
                            await self._websocket.send(json.dumps(response))
                    elif message.get("notification"):
                        if message.get("method") == "peerLeft":
                            peer_id = message["data"]["peerId"]
                            print(f"Peer {peer_id} has left the call.")
                            self.close()
                        else:
                            print(message)
            except websockets.ConnectionClosedOK:
                # Handle the normal closure of the WebSocket
                print("WebSocket connection closed normally.")
                break  
            except Exception as e:
                print(f"Error in recv_msg_task: {e}")
                break          

    # wait for answer ready
    async def _wait_for(
        self, fut: Awaitable[T], timeout: Optional[float], **kwargs: Any
    ) -> T:
        try:
            return await asyncio.wait_for(fut, timeout=timeout, **kwargs)
        except asyncio.TimeoutError:
            print("Operation timed out")
            return

    async def _send_request(self, request):
        self._answers[request["id"]] = self._loop.create_future()
        await self._websocket.send(json.dumps(request))

    # Generates a random positive integer.
    def generateRandomNumber(self) -> int:
        return round(random() * 10000000)

    async def run(self):
        self._websocket = await websockets.connect(self._uri, subprotocols=["protoo"])
        
        if sys.version_info < (3, 7):
            task_run_recv_msg = asyncio.ensure_future(self.recv_msg_task())
        else:
            task_run_recv_msg = asyncio.create_task(self.recv_msg_task())
        #self._tasks.append(task_run_recv_msg)

        #print('*** task:', self._tasks)

        await self.load()
        await self.createSendTransport()
        await self.createRecvTransport()
        await self.produce()

        await self.leaveRoom()

    async def load(self):
        # Init device
        self._device = Device(
            handlerFactory=AiortcHandler.createFactory(tracks=self._tracks)
        )

        # Get Router RtpCapabilities
        reqId = self.generateRandomNumber()
        req = {
            "request": True,
            "id": reqId,
            "method": "getRouterRtpCapabilities",
            "data": {},
        }
        await self._send_request(req)
        ans = await self._wait_for(self._answers[reqId], timeout=15)

        # Load Router RtpCapabilities
        await self._device.load(ans["data"])

    async def createSendTransport(self):
        if self._sendTransport is not None:
            return
        # Send create sendTransport request
        reqId = self.generateRandomNumber()
        req = {
            "request": True,
            "id": reqId,
            "method": "createWebRtcTransport",
            "data": {
                "forceTcp": False,
                "producing": True,
                "consuming": False,
                "sctpCapabilities": self._device.sctpCapabilities.dict(),
            },
        }
        await self._send_request(req)
        ans = await self._wait_for(self._answers[reqId], timeout=15)

        # Create sendTransport
        self._sendTransport = self._device.createSendTransport(
            id=ans["data"]["id"],
            iceParameters=ans["data"]["iceParameters"],
            iceCandidates=ans["data"]["iceCandidates"],
            dtlsParameters=ans["data"]["dtlsParameters"],
            sctpParameters=ans["data"]["sctpParameters"],
            iceServers=ans["data"]["iceServers"]
        )

        @self._sendTransport.on("connect")
        async def on_connect(dtlsParameters):
            reqId = self.generateRandomNumber()
            req = {
                "request": True,
                "id": reqId,
                "method": "connectWebRtcTransport",
                "data": {
                    "transportId": self._sendTransport.id,
                    "dtlsParameters": dtlsParameters.dict(exclude_none=True),
                },
            }
            await self._send_request(req)
            ans = await self._wait_for(self._answers[reqId], timeout=15)
            print(ans)

        @self._sendTransport.on("produce")
        async def on_produce(kind: str, rtpParameters, appData: dict):
            reqId = self.generateRandomNumber()
            req = {
                "id": reqId,
                "method": "produce",
                "request": True,
                "data": {
                    "transportId": self._sendTransport.id,
                    "kind": kind,
                    "rtpParameters": rtpParameters.dict(exclude_none=True),
                    "appData": appData,
                },
            }
            await self._send_request(req)
            ans = await self._wait_for(self._answers[reqId], timeout=15)
            return ans["data"]["id"]

        @self._sendTransport.on("producedata")
        async def on_producedata(
            sctpStreamParameters: SctpStreamParameters,
            label: str,
            protocol: str,
            appData: dict,
        ):

            reqId = self.generateRandomNumber()
            req = {
                "id": reqId,
                "method": "produceData",
                "request": True,
                "data": {
                    "transportId": self._sendTransport.id,
                    "label": label,
                    "protocol": protocol,
                    "sctpStreamParameters": sctpStreamParameters.dict(
                        exclude_none=True
                    ),
                    "appData": appData,
                },
            }
            await self._send_request(req)
            ans = await self._wait_for(self._answers[reqId], timeout=15)
            return ans["data"]["id"]
        
    async def produce(self):
        try:
            await asyncio.wait_for(self._produce_logic(), timeout=self._time)
        except asyncio.TimeoutError:
            print("Closing the script.")
            return
        except Exception as e:
            # Handle other exceptions if needed
            print(f"An error occurred: {e}")
            return
    
    async def _produce_logic(self):
        if self._sendTransport is None:
            await self.createSendTransport()

        # Join room
        reqId = self.generateRandomNumber()
        req = {
            "request": True,
            "id": reqId,
            "method": "join",
            "data": {
                "displayName": "pymediasoup",
                "device": {"flag": "python", "name": "python", "version": "0.1.0"},
                "rtpCapabilities": self._device.rtpCapabilities.dict(exclude_none=True),
                "sctpCapabilities": self._device.sctpCapabilities.dict(
                    exclude_none=True
                ),
            },
        }
        await self._send_request(req)
        ans = await self._wait_for(self._answers[reqId], timeout=15)
        print(ans)

        # produce
        videoProducer: Producer = await self._sendTransport.produce(
            track=self._videoTrack, stopTracks=False, appData={}
        )
        self._producers.append(videoProducer)
        audioProducer: Producer = await self._sendTransport.produce(
            track=self._audioTrack, stopTracks=False, appData={}
        )
        self._producers.append(audioProducer)

        return
        # produce data
        #await self.produceData()

    async def produceData(self):
        if self._sendTransport is None:
            await self.createSendTransport()

        reqId = self.generateRandomNumber()
        req = {
            "request": True,
            "id": reqId,
            "method": "close",  
            "data": {}
        }

        await self._send_request(req)

        dataProducer: DataProducer = await self._sendTransport.produceData(
            ordered=False,
            maxPacketLifeTime=5555,
            label="chat",
            protocol="",
            appData={"info": "my-chat-DataProducer"},
        )
        self._producers.append(dataProducer)
        while not self._closed:
            await asyncio.sleep(1)
            dataProducer.send("hello")

    async def createRecvTransport(self):
        if self._recvTransport is not None:
            return
        # Send create recvTransport request
        reqId = self.generateRandomNumber()
        req = {
            "request": True,
            "id": reqId,
            "method": "createWebRtcTransport",
            "data": {
                "forceTcp": False,
                "producing": False,
                "consuming": True,
                "sctpCapabilities": self._device.sctpCapabilities.dict(),
            },
        }
        await self._send_request(req)
        ans = await self._wait_for(self._answers[reqId], timeout=15)

        # Create recvTransport
        self._recvTransport = self._device.createRecvTransport(
            id=ans["data"]["id"],
            iceParameters=ans["data"]["iceParameters"],
            iceCandidates=ans["data"]["iceCandidates"],
            dtlsParameters=ans["data"]["dtlsParameters"],
            sctpParameters=ans["data"]["sctpParameters"],
            iceServers=ans["data"]["iceServers"]
        )

        @self._recvTransport.on("connect")
        async def on_connect(dtlsParameters):
            reqId = self.generateRandomNumber()
            req = {
                "request": True,
                "id": reqId,
                "method": "connectWebRtcTransport",
                "data": {
                    "transportId": self._recvTransport.id,
                    "dtlsParameters": dtlsParameters.dict(exclude_none=True),
                },
            }
            await self._send_request(req)
            ans = await self._wait_for(self._answers[reqId], timeout=15)
            print(ans)

    async def consume(self, id, producerId, kind, rtpParameters):
        if self._recvTransport is None:
            await self.createRecvTransport()
        consumer: Consumer = await self._recvTransport.consume(
            id=id, producerId=producerId, kind=kind, rtpParameters=rtpParameters
        )
        self._consumers.append(consumer)
        self._recorder.addTrack(consumer.track)
        await self._recorder.start()

    async def consumeData(
        self,
        id,
        dataProducerId,
        sctpStreamParameters,
        label=None,
        protocol=None,
        appData={},
    ):
        pass
        dataConsumer: DataConsumer = await self._recvTransport.consumeData(
            id=id,
            dataProducerId=dataProducerId,
            sctpStreamParameters=sctpStreamParameters,
            label=label,
            protocol=protocol,
            appData=appData,
        )
        self._consumers.append(dataConsumer)

        @dataConsumer.on("message")
        def on_message(message):
            print(f"DataChannel {label}-{protocol}: {message}")

    async def close(self):
        for consumer in self._consumers:
            print('close consumers')
            await consumer.close()
        for producer in self._producers:
            print('close producer')
            await producer.close()
        for task in self._tasks:
            print('close task')
            await task.cancel()
        if self._sendTransport:
            print('close _sendTransport')
            await self._sendTransport.close()
        if self._recvTransport:
            print('close _recvTransport')
            await self._recvTransport.close()
        
        await self._websocket.close()
        await self._recorder.stop()

    async def leaveRoom(self):
        try:
            print('**** Initialize leaveRoom method ****')
            # Generate a unique request ID
            reqId = self.generateRandomNumber()

            # Create the leaveCall request
            req = {
                "request": True,
                "id": reqId,
                "method": "leaveRoom",
                "data": {}
            }

            # Send the request to the server
            await self._send_request(req)
            
            # Wait for the server response
            ans = await self._wait_for(self._answers[reqId], timeout=15)

            await self._websocket.close()

        except Exception as e:
            print(f"Error in leaveRoom: {e}")
            

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PyMediaSoup")
    parser.add_argument("room", nargs="?", help="Room ID for the WebRTC session")
    parser.add_argument("--play-from", help="Read the media from a file and send it.")
    parser.add_argument("--record-to", help="Write received media to a file.")
    parser.add_argument("--wsurl", help="WebSocket URL to connect to Mediasoup server", nargs="?")
    args = parser.parse_args()

    # Show received args
    print('****args:', args)

    # Generate roomId if not provided
    if not args.room:
        args.room = secrets.token_urlsafe(8).lower()

    # Generate peer id
    peerId = secrets.token_urlsafe(8).lower()

    # Use wsurl if provided. Otherwise construct URI from default dev demo server
    if not args.wsurl:
        uri = f"wss://dts-webrtc.dev.2060.io:443/?roomId={args.room}&peerId={peerId}"
    else:
        uri = args.wsurl

    print(f"Connecting to WebSocket URI: {uri}")

    if args.play_from:
        player = MediaPlayer(args.play_from)
    else:
        player = None

    
    # create media sink
    if args.record_to:
        recorder = MediaRecorder(args.record_to)
    else:
        recorder = MediaBlackhole()

    # run event loop
    loop = asyncio.get_event_loop()

    try:
        demo = Demo(uri=uri, player=player, recorder=recorder, loop=loop)
        loop.run_until_complete(demo.run())
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(demo.close())
