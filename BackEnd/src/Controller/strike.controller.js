const Strike = require('../model/Strike.model');
const Task = require('../model/Task.model');
const User = require('../model/user.model');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeCompanyKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '');

const normalizeEmail = (v) => normalizeText(v).toLowerCase();
const normalizeRoleKey = (v) => normalizeText(v).toLowerCase().replace(/[\s-]+/g, '_');

const isOverdueTask = (task) => {
  try {
    const status = normalizeText(task?.status).toLowerCase();
    if (status === 'completed') return false;
    const due = new Date(task?.dueDate);
    if (Number.isNaN(due.getTime())) return false;

    // Not overdue on due date itself; overdue starts only after due day ends.
    const dueEndOfDay = new Date(
      due.getFullYear(),
      due.getMonth(),
      due.getDate(),
      23,
      59,
      59,
      999
    );

    return Date.now() > dueEndOfDay.getTime();
  } catch {
    return false;
  }
};

const isLateCompletedTask = (task) => {
  try {
    const status = normalizeText(task?.status).toLowerCase();
    if (status !== 'completed') return false;
    const due = new Date(task?.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    const completedAt = new Date(task?.statusUpdatedAt);
    if (Number.isNaN(completedAt.getTime())) return false;

    const dueEndOfDay = new Date(
      due.getFullYear(),
      due.getMonth(),
      due.getDate(),
      23,
      59,
      59,
      999
    );

    return completedAt.getTime() > dueEndOfDay.getTime();
  } catch {
    return false;
  }
};

const buildRemovedBy = (user) => {
  const u = user && typeof user === 'object' ? user : {};
  const id = u.id || u._id || u.userId;
  return {
    id: id != null ? String(id) : undefined,
    name: u.name ? String(u.name) : undefined,
    email: u.email ? String(u.email) : undefined,
    role: u.role ? String(u.role) : undefined
  };
};

exports.getMdImpexStrike = async (req, res) => {
  try {
    const companyKey = 'mdimpex';

    const currentEmail = normalizeEmail(req.user?.email);
    const currentRoleKey = normalizeRoleKey(req.user?.role);
    
    // Parse month filter from query (format: YYYY-MM)
    const monthFilter = req.query?.month ? String(req.query.month).trim() : '';
    let yearFilter = null;
    let monthNumber = null;
    
    if (monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)) {
      const [yearStr, monthStr] = monthFilter.split('-');
      yearFilter = parseInt(yearStr, 10);
      monthNumber = parseInt(monthStr, 10);
    }

    // Build date filter for tasks if month is specified
    const dateFilter = {};
    if (yearFilter !== null && monthNumber !== null) {
      const startOfMonth = new Date(yearFilter, monthNumber - 1, 1);
      const endOfMonth = new Date(yearFilter, monthNumber, 0, 23, 59, 59, 999);
      dateFilter.dueDate = { $gte: startOfMonth, $lte: endOfMonth };
    }

    // 1) Fetch tasks that can potentially produce strikes.
    const taskQuery = {
      isDeleted: { $ne: true },
      companyName: { $regex: /^\s*md\s*impex\s*$/i },
      ...dateFilter
    };
    
    const tasks = await Task.find(taskQuery).lean();

    // Build scope: tasks that are eligible for strike tracking.
    // Rule: only tasks assigned BY an MD Manager (or All Manager) TO a Manager.
    // Exclude self-assign (assignedBy == assignedTo).
    // Additionally: when the logged-in user is md_manager/all_manager,
    // show ONLY the tasks that this MD Manager assigned.
    const candidateEmails = new Set();
    (tasks || []).forEach((t) => {
      const by = normalizeEmail(t?.assignedBy);
      const to = normalizeEmail(t?.assignedTo);
      if (by) candidateEmails.add(by);
      if (to) candidateEmails.add(to);
    });

    const emailList = Array.from(candidateEmails.values());
    const userDocs = emailList.length
      ? await User.find({
          isDeleted: { $ne: true },
          email: { $in: emailList }
        })
          .select('email role')
          .lean()
      : [];

    const roleByEmail = new Map((userDocs || []).map((u) => [normalizeEmail(u?.email), normalizeRoleKey(u?.role)]));

    const scopedTasks = (tasks || []).filter((t) => {
      const assignedBy = normalizeEmail(t?.assignedBy);
      const assignedTo = normalizeEmail(t?.assignedTo);
      if (!assignedBy || !assignedTo) return false;
      if (assignedBy === assignedTo) return false;

      const assignerRole = roleByEmail.get(assignedBy) || '';
      const assigneeRole = roleByEmail.get(assignedTo) || '';

      const assignerIsMd = assignerRole === 'md_manager' || assignerRole === 'all_manager';
      const assigneeIsManager = assigneeRole === 'manager';

      if (!assignerIsMd || !assigneeIsManager) return false;

      if ((currentRoleKey === 'md_manager' || currentRoleKey === 'all_manager') && currentEmail) {
        return assignedBy === currentEmail;
      }

      return true;
    });

    const scopedTaskIds = scopedTasks
      .map((t) => String(t?._id || '').trim())
      .filter(Boolean);

    // 2) Determine new strike candidates within scope (overdue or late completed).
    const strikeCandidateTasks = (scopedTasks || []).filter((t) => isOverdueTask(t) || isLateCompletedTask(t));
    const candidateTaskIds = strikeCandidateTasks
      .map((t) => String(t?._id || '').trim())
      .filter(Boolean);

    // Build date filter for removal history if month is specified
    const removalHistoryDateFilter = {};
    if (yearFilter !== null && monthNumber !== null) {
      const startOfMonth = new Date(yearFilter, monthNumber - 1, 1);
      const endOfMonth = new Date(yearFilter, monthNumber, 0, 23, 59, 59, 999);
      removalHistoryDateFilter['removalHistory.removedAt'] = { 
        $gte: startOfMonth, 
        $lte: endOfMonth 
      };
    }
    if (candidateTaskIds.length > 0) {
      const existing = await Strike.find({ companyKey, taskId: { $in: candidateTaskIds } }).select('_id taskId').lean();
      const existingSet = new Set((existing || []).map((s) => String(s.taskId || '').trim()));

      const inserts = strikeCandidateTasks
        .filter((t) => !existingSet.has(String(t?._id || '').trim()))
        .map((t) => {
          const due = new Date(t?.dueDate);
          const dueSafe = Number.isNaN(due.getTime()) ? null : due;
          return {
            taskId: String(t?._id || '').trim(),
            companyKey,
            firstOverdueAt: dueSafe,
            isRemoved: false,
            removalHistory: []
          };
        });

      if (inserts.length > 0) {
        await Strike.insertMany(inserts, { ordered: false }).catch(() => undefined);
      }
    }

    // 5) Return strike docs for THIS scope only, attaching task snapshot.
    const strikes = scopedTaskIds.length
      ? await Strike.find({ companyKey, taskId: { $in: scopedTaskIds } }).sort({ createdAt: -1 }).lean()
      : [];
    const taskIds = (strikes || []).map((s) => String(s.taskId || '').trim()).filter(Boolean);
    const tasksById = new Map((tasks || []).map((t) => [String(t?._id || '').trim(), t]));

    const data = (strikes || []).map((s) => ({
      id: String(s._id || s.id || ''),
      taskId: String(s.taskId || ''),
      companyKey: String(s.companyKey || ''),
      firstOverdueAt: s.firstOverdueAt,
      isRemoved: Boolean(s.isRemoved),
      removalHistory: Array.isArray(s.removalHistory) ? s.removalHistory : [],
      task: tasksById.get(String(s.taskId || '').trim()) || null
    }));

    return res.json({ success: true, data, message: 'Strike fetched successfully' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch strike', error: e?.message || e });
  }
};

exports.removeStrike = async (req, res) => {
  try {
    const strikeId = String(req.params?.id || '').trim();
    const remark = normalizeText(req.body?.remark);

    if (!strikeId) {
      return res.status(400).json({ success: false, message: 'Strike id is required' });
    }

    const strike = await Strike.findById(strikeId);
    if (!strike) {
      return res.status(404).json({ success: false, message: 'Strike not found' });
    }

    if (strike.isRemoved) {
      return res.json({ success: true, data: strike, message: 'Strike already removed' });
    }

    strike.isRemoved = true;
    strike.removalHistory = Array.isArray(strike.removalHistory) ? strike.removalHistory : [];
    strike.removalHistory.push({
      remark,
      removedAt: new Date(),
      removedBy: buildRemovedBy(req.user)
    });

    await strike.save();

    return res.json({ success: true, data: strike, message: 'Strike removed successfully' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to remove strike', error: e?.message || e });
  }
};
