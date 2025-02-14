import express, { Request, Response } from 'express'
import axios from 'axios'
import { WebRTCClient } from './WebRTCClient'

// A default video URL to play (fallback if none provided)
const DEFAULT_VIDEO_SRC_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const PORT = process.env.APP_PORT || 3100

const app = express()
app.use(express.json())

/**
 * POST /join-call
 * Connects to a Mediasoup WebRTC server, plays a video, and notifies success/failure.
 *
 * Body params:
 * - ws_url (string) : The protoo WebSocket URL for the Mediasoup server. (Required)
 * - success_url (string) : The endpoint to PUT if the video finishes. (Optional)
 * - failure_url (string) : The endpoint to PUT if an error occurs. (Optional)
 */
app.post('/join-call', async (req: Request, res: Response) => {
  const { ws_url, success_url, failure_url } = req.body

  if (!ws_url) {
    res.status(400).json({ error: 'Missing ws_url parameter' })
    return
  }

  // Create the WebRTCClient
  const client = new WebRTCClient({
    wsUrl: ws_url,
    urlToPlay: DEFAULT_VIDEO_SRC_URL,
  })

  try {
    // Connect and produce
    await client.connect()

    // Typically respond immediately
    res.json({ status: 'ok', ws_url, success_url, failure_url })
  } catch (err) {
    console.error('Error connecting WebRTCClient:', err)

    // Optionally notify the failure_url
    if (failure_url) {
      try {
        await axios.put(failure_url, {
          status: 'error',
          error: String(err),
        })
      } catch (notifyErr) {
        console.error('Failed to notify failure_url:', notifyErr)
      }
    }

    res.status(500).json({ error: 'Failed to join call', details: String(err) })
  }
})

// Start listening
app.listen(PORT, () => {
  console.log(`REST server listening on http://localhost:${PORT}`)
})
