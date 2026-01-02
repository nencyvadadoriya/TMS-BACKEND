const jwt = require('jsonwebtoken');
const User = require('../model/user.model');
const { buildGoogleAuthUrl, exchangeCodeForTokens } = require('../utils/googleCalendar.util');
const { runGoogleTasksImportForUserId } = require('../utils/googleTasksSync.job');

const getJwtSecret = () => process.env.JWT_SECRET || 'secret';

const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

exports.getAuthUrl = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const state = jwt.sign(
            { userId: userId.toString(), purpose: 'google_oauth' },
            getJwtSecret(),
            { expiresIn: '10m' }
        );

        const url = buildGoogleAuthUrl({
            state,
            scopes: ['https://www.googleapis.com/auth/tasks']
        });

        let redirectUri = null;
        let clientId = null;
        try {
            const parsed = new URL(url);
            redirectUri = parsed.searchParams.get('redirect_uri');
            clientId = parsed.searchParams.get('client_id');
        } catch {
            redirectUri = null;
            clientId = null;
        }

        console.log('Google OAuth auth-url generated:', { redirectUri, clientId });
        return res.status(200).json({ success: true, url, redirectUri, clientId });
    } catch (error) {
        console.error('Google OAuth getAuthUrl error:', error);

        const message = error?.message || 'Internal Server Error';
        const missingEnvPrefix = 'Missing environment variable:';

        if (typeof message === 'string' && message.startsWith(missingEnvPrefix)) {
            const missingEnv = message.slice(missingEnvPrefix.length).trim();
            return res.status(500).json({ success: false, message, missingEnv });
        }

        return res.status(500).json({ success: false, message });
    }
};

exports.callback = async (req, res) => {
    try {
        const { code, state } = req.query || {};

        if (!code || !state) {
            return res.status(400).send('Missing code or state');
        }

        let decoded;
        try {
            decoded = jwt.verify(state, getJwtSecret());
        } catch (error) {
            return res.status(400).send('Invalid state');
        }

        if (!decoded?.userId || decoded.purpose !== 'google_oauth') {
            return res.status(400).send('Invalid state');
        }

        const tokenResponse = await exchangeCodeForTokens(code);

        const existingUser = await User.findById(decoded.userId)
            .select('googleOAuth.refreshToken googleOAuth.scope')
            .lean();

        const refreshToken = tokenResponse.refresh_token
            || existingUser?.googleOAuth?.refreshToken
            || null;

        const scope = tokenResponse.scope
            ? tokenResponse.scope.split(' ')
            : (Array.isArray(existingUser?.googleOAuth?.scope) ? existingUser.googleOAuth.scope : []);

        if (!refreshToken) {
            return res.redirect(`${getFrontendUrl()}/profile?google=missing_refresh_token`);
        }

        await User.findByIdAndUpdate(decoded.userId, {
            isGoogleCalendarConnected: true,
            googleOAuth: {
                refreshToken,
                scope,
                connectedAt: new Date()
            }
        });

        return res.redirect(`${getFrontendUrl()}/profile?google=connected`);
    } catch (error) {
        const statusCode = error?.statusCode;
        const responseBody = error?.responseBody;
        const rawReason =
            (responseBody && typeof responseBody === 'object' && (responseBody.error_description || responseBody.error))
                ? (responseBody.error_description || responseBody.error)
                : (error?.message || 'unknown');

        const reason = encodeURIComponent(String(rawReason).slice(0, 160));

        console.error('Google OAuth callback error:', {
            statusCode,
            responseBody,
            message: error?.message
        });

        return res.redirect(`${getFrontendUrl()}/profile?google=error&reason=${reason}`);
    }
};

exports.status = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const user = await User.findById(userId).select('isGoogleCalendarConnected googleOAuth.connectedAt');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({
            success: true,
            connected: Boolean(user.isGoogleCalendarConnected && user.googleOAuth?.connectedAt),
            connectedAt: user.googleOAuth?.connectedAt || null
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.disconnect = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        await User.findByIdAndUpdate(userId, {
            isGoogleCalendarConnected: false,
            googleOAuth: {
                refreshToken: null,
                scope: [],
                connectedAt: null
            }
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.syncTasksNow = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await runGoogleTasksImportForUserId({ userId: userId.toString() });
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to sync tasks now' });
    }
};
