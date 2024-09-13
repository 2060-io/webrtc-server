
const validateCreateRoomParams = (req, res, next) => {
  const { eventNotificationUri, maxPeerCount } = req.body;

  // Validate that eventNotificationUri is a string
  if (!eventNotificationUri || typeof eventNotificationUri !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing eventNotificationUri' });
  }

  // Validate that maxPeersCount is a number
  if (maxPeerCount !== undefined && maxPeerCount !== '') {
    if (typeof maxPeerCount !== 'number') {
      return res.status(400).json({ error: 'Invalid maxPeerCount, it must be a number if defined' });
    }

    if (maxPeerCount < 2) {
      return res.status(400).json({ error: 'maxPeerCount must be at least 2' });
    }
  }

  // If validation passes, move to the next middleware or route handler
  next();
}

module.exports = { validateCreateRoomParams };
