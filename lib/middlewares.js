
const validateCreateRoomParams = (req, res, next) => {
  const { eventNotificationUri, maxPeersRoom } = req.body;

  // Validate that eventNotificationUri is a string
  if (!eventNotificationUri || typeof eventNotificationUri !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing eventNotificationUri' });
  }

  // Validate that maxPeersCount is a number
  if (!maxPeersRoom || typeof maxPeersRoom !== 'number') {
    return res.status(400).json({ error: 'Invalid or missing maxPeersCount' });
  }

  // If validation passes, move to the next middleware or route handler
  next();
}

module.exports = { validateCreateRoomParams };
