const https = require('https');

const readEnv = (key, fallbackKeys = []) => {
    const candidates = [key, ...fallbackKeys].filter(Boolean);
    for (const candidate of candidates) {
        const value = process.env[candidate];
        if (value) {
            return value;
        }
    }
    throw new Error(`Missing environment variable: ${key}`);
};

const normalizeBaseUrl = (value) => {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://${trimmed}`;
};

const resolveRedirectUri = () => {
    const direct = process.env.GOOGLE_REDIRECT_URI;
    if (direct && String(direct).trim()) {
        return String(direct).trim();
    }

    const publicBackendUrl =
        normalizeBaseUrl(process.env.PUBLIC_BACKEND_URL)
        || normalizeBaseUrl(process.env.BACKEND_URL)
        || normalizeBaseUrl(process.env.VERCEL_URL);

    if (publicBackendUrl) {
        return `${publicBackendUrl}/api/google/callback`;
    }

    return 'http://localhost:9000/api/google/callback';
};

const requestJson = ({ method, url, headers = {}, body }) => {
    return new Promise((resolve, reject) => {
        try {
            const parsed = new URL(url);
            const options = {
                method,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search}`,
                headers
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    const statusCode = res.statusCode || 0;
                    const contentType = String(res.headers['content-type'] || '');
                    let parsedBody = data;

                    if (contentType.includes('application/json')) {
                        try {
                            parsedBody = data ? JSON.parse(data) : {};
                        } catch {
                            parsedBody = data;
                        }
                    }

                    if (statusCode >= 200 && statusCode < 300) {
                        resolve({ statusCode, body: parsedBody });
                        return;
                    }

                    const err = new Error(`Request failed with status ${statusCode}`);
                    err.statusCode = statusCode;
                    err.responseBody = parsedBody;
                    reject(err);
                });
            });

            req.on('error', reject);

            if (body !== undefined) {
                req.write(body);
            }

            req.end();
        } catch (error) {
            reject(error);
        }
    });
};

const buildGoogleAuthUrl = ({ state, scopes }) => {
    const clientId = readEnv('GOOGLE_CLIENT_ID', ['VITE_GOOGLE_CLIENT_ID']);
    const redirectUri = resolveRedirectUri();

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes.join(' '),
        state
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const exchangeCodeForTokens = async (code) => {
    const clientId = readEnv('GOOGLE_CLIENT_ID', ['VITE_GOOGLE_CLIENT_ID']);
    const clientSecret = readEnv('GOOGLE_CLIENT_SECRET');
    const redirectUri = resolveRedirectUri();

    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    }).toString();

    const { body: tokenResponse } = await requestJson({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });

    return tokenResponse;
};

const refreshAccessToken = async (refreshToken) => {
    const clientId = readEnv('GOOGLE_CLIENT_ID', ['VITE_GOOGLE_CLIENT_ID']);
    const clientSecret = readEnv('GOOGLE_CLIENT_SECRET');

    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token'
    }).toString();

    const { body: tokenResponse } = await requestJson({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });

    return tokenResponse;
};

const createCalendarEvent = async ({ accessToken, event }) => {
    const body = JSON.stringify(event);

    const { body: responseBody } = await requestJson({
        method: 'POST',
        url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });

    return responseBody;
};

const listGoogleTaskLists = async ({ accessToken, pageToken, maxResults = 100 } = {}) => {
    const params = new URLSearchParams();
    if (pageToken) params.set('pageToken', String(pageToken));
    params.set('maxResults', String(maxResults));

    const { body: responseBody } = await requestJson({
        method: 'GET',
        url: `https://tasks.googleapis.com/tasks/v1/users/@me/lists?${params.toString()}`,
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    return responseBody;
};

const listGoogleTasks = async ({
    accessToken,
    tasklistId = '@default',
    pageToken,
    updatedMin,
    showCompleted = true,
    showDeleted = true,
    showHidden = true,
    maxResults = 100
}) => {
    const params = new URLSearchParams();
    if (pageToken) params.set('pageToken', String(pageToken));
    if (updatedMin) params.set('updatedMin', String(updatedMin));
    params.set('showCompleted', String(Boolean(showCompleted)));
    params.set('showDeleted', String(Boolean(showDeleted)));
    params.set('showHidden', String(Boolean(showHidden)));
    params.set('maxResults', String(maxResults));

    const { body: responseBody } = await requestJson({
        method: 'GET',
        url: `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks?${params.toString()}`,
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    return responseBody;
};

const createGoogleTask = async ({ accessToken, tasklistId = '@default', task }) => {
    const body = JSON.stringify(task);

    const { body: responseBody } = await requestJson({
        method: 'POST',
        url: `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks`,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });

    return responseBody;
};

const getGoogleTask = async ({ accessToken, tasklistId = '@default', taskId }) => {
    if (!taskId) {
        throw new Error('Missing taskId');
    }

    const { body: responseBody } = await requestJson({
        method: 'GET',
        url: `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    return responseBody;
};

const updateGoogleTask = async ({ accessToken, tasklistId = '@default', taskId, patch }) => {
    if (!taskId) {
        throw new Error('Missing taskId');
    }

    const body = JSON.stringify(patch || {});

    const { body: responseBody } = await requestJson({
        method: 'PATCH',
        url: `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    });

    return responseBody;
};

const createTaskCalendarInvite = async ({ refreshToken, task, attendeeEmails = [] }) => {
    if (!refreshToken) {
        throw new Error('Missing refresh token');
    }

    const tokenResponse = await refreshAccessToken(refreshToken);
    const accessToken = tokenResponse.access_token;

    if (!accessToken) {
        throw new Error('Failed to refresh access token');
    }

    const normalizedAttendees = (Array.isArray(attendeeEmails) ? attendeeEmails : [])
        .map((email) => (email || '').toString().trim().toLowerCase())
        .filter(Boolean);

    const descriptionParts = [
        `Task: ${task.title}`,
        task.companyName ? `Company: ${task.companyName}` : null,
        task.brand ? `Brand: ${task.brand}` : null,
        task.priority ? `Priority: ${task.priority}` : null,
        task.taskType ? `Task Type: ${task.taskType}` : null,
        task.status ? `Status: ${task.status}` : null,
        task.assignedBy ? `Assigned By: ${task.assignedBy}` : null,
        task.assignedTo ? `Assigned To: ${task.assignedTo}` : null
    ].filter(Boolean);

    const notesParts = [
        ...descriptionParts,
        normalizedAttendees.length ? `Attendees: ${normalizedAttendees.join(', ')}` : null
    ].filter(Boolean);

    const dueDate = task?.dueDate ? new Date(task.dueDate) : null;
    const due = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : undefined;

    const googleTask = {
        title: (task?.title || '').toString(),
        notes: notesParts.join('\n'),
        ...(due ? { due } : {}),
        status: String(task?.status || '').toLowerCase() === 'completed' ? 'completed' : 'needsAction'
    };

    if (googleTask.status === 'completed') {
        googleTask.completed = new Date().toISOString();
    }

    return createGoogleTask({ accessToken, task: googleTask });
};

module.exports = {
    buildGoogleAuthUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    createCalendarEvent,
    createGoogleTask,
    getGoogleTask,
    updateGoogleTask,
    listGoogleTasks,
    listGoogleTaskLists,
    createTaskCalendarInvite
};
