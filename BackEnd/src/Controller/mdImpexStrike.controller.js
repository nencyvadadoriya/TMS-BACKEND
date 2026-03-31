const MdImpexStrike = require('../model/MdImpexStrike.model');
const User = require('../model/user.model');
const { sendStrikeAssignedEmail } = require('../middleware/email.message');
const { sendStrikeAssignedPush } = require('../utils/pushNotifications.util');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();

exports.createStrike = async (req, res) => {
  try {
    const { date, time, pocEmail, brandName, strikeTitle, company, reason } = req.body;

    if (!date || !time || !pocEmail || !strikeTitle || !reason) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Role check is handled by middleware, but we can double check or get user info
    const assignedByEmail = req.user.email;
    const assignedByName = req.user.name || req.user.email;

    // Find the POC user to get their full name
    const pocUser = await User.findOne({ email: pocEmail.toLowerCase() }).select('name email').lean();
    if (!pocUser) {
      return res.status(404).json({ success: false, message: 'POC user not found' });
    }

    const newStrike = new MdImpexStrike({
      date: new Date(date),
      time,
      poc: {
        name: pocUser.name,
        email: pocUser.email
      },
      brandName,
      strikeTitle,
      assignBy: {
        name: assignedByName,
        email: assignedByEmail
      },
      company: company || 'MD-Impex',
      reason
    });

    await newStrike.save();

    // Send notifications
    try {
      await sendStrikeAssignedEmail({
        toEmail: pocUser.email,
        toName: pocUser.name,
        assignedByName,
        assignedByEmail,
        strikeTitle,
        reason,
        date,
        time
      });
      await sendStrikeAssignedPush({
        toEmail: pocUser.email,
        strikeTitle,
        assignedByName
      });
    } catch (notifErr) {
      console.error('Error sending strike notifications:', notifErr);
    }

    return res.status(201).json({ success: true, data: newStrike, message: 'Strike added successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create strike', error: error.message });
  }
};

exports.getStrikes = async (req, res) => {
  try {
    const monthFilter = req.query.month ? String(req.query.month).trim() : '';
    let filter = {};

    if (monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)) {
      const [yearStr, monthStr] = monthFilter.split('-');
      const year = parseInt(yearStr, 10);
      const monthNumber = parseInt(monthStr, 10);

      const startOfMonth = new Date(year, monthNumber - 1, 1);
      const endOfMonth = new Date(year, monthNumber, 0, 23, 59, 59, 999);

      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const role = (req.user && req.user.role) ? String(req.user.role).trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
    const email = (req.user && req.user.email) ? String(req.user.email).trim().toLowerCase() : '';

    if (!['md_manager', 'ob_manager', 'admin', 'super_admin'].includes(role)) {
      filter['poc.email'] = email;
    }

    const strikes = await MdImpexStrike.find(filter).sort({ date: -1, createdAt: -1 }).lean();

    return res.status(200).json({ success: true, data: strikes });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch strikes', error: error.message });
  }
};

exports.updateStrike = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    // Only allow specific updates
    if (updateData.date) updateData.date = new Date(updateData.date);

    if (updateData.pocEmail) {
      const pocUser = await User.findOne({ email: updateData.pocEmail.toLowerCase() }).select('name email').lean();
      if (pocUser) {
        updateData.poc = { name: pocUser.name, email: pocUser.email };
      }
      delete updateData.pocEmail;
    }

    const updatedStrike = await MdImpexStrike.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedStrike) {
      return res.status(404).json({ success: false, message: 'Strike not found' });
    }

    return res.status(200).json({ success: true, data: updatedStrike, message: 'Strike updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update strike', error: error.message });
  }
};

exports.deleteStrike = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedStrike = await MdImpexStrike.findByIdAndDelete(id);

    if (!deletedStrike) {
      return res.status(404).json({ success: false, message: 'Strike not found' });
    }

    return res.status(200).json({ success: true, message: 'Strike deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete strike', error: error.message });
  }
};
