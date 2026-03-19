const Headline = require('../model/Headline.model');
const { getIO } = require('../realtime/socket');

exports.getActiveHeadline = async (req, res) => {
  try {
    const now = new Date();
    const headline = await Headline.findOne({ 
      active: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } }
      ]
    }).sort({ createdAt: -1 }).populate('createdBy', 'name email');
    res.status(200).json({ success: true, data: headline });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createHeadline = async (req, res) => {
  try {
    const { text, type, expiresAt, bgColor, textColor } = req.body;
    
    // Deactivate previous active headlines
    await Headline.updateMany({ active: true }, { active: false });
    
    const newHeadline = new Headline({
      text,
      type,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      bgColor,
      textColor,
      createdBy: req.user.id,
      active: true
    });
    
    await newHeadline.save();
    
    // Notify all clients via WebSocket
    try {
      getIO().emit('headline_update', { action: 'created', data: newHeadline });
    } catch (err) {
      console.error('[Socket] Failed to emit headline_update:', err.message);
    }
    
    res.status(201).json({ success: true, data: newHeadline });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deactivateHeadline = async (req, res) => {
  try {
    await Headline.updateMany({ active: true }, { active: false });
    
    // Notify all clients via WebSocket
    try {
      getIO().emit('headline_update', { action: 'deactivated' });
    } catch (err) {
      console.error('[Socket] Failed to emit headline_update:', err.message);
    }
    
    res.status(200).json({ success: true, message: 'Headline deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
