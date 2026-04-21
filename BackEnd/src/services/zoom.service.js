const ZOOM_API_BASE_URL = 'https://api.zoom.us/v2';
const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';

const getZoomToken = async () => {
    const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
        throw new Error('Zoom credentials are missing in environment variables');
    }

    const auth = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

    const response = await fetch(`${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('Zoom Auth Error:', data);
        throw new Error(data.reason || 'Failed to get Zoom access token');
    }

    return data.access_token;
};

const createZoomMeeting = async (meetingDetails) => {
    const { meetingName, startTime, duration, description } = meetingDetails;
    const token = await getZoomToken();

    const response = await fetch(`${ZOOM_API_BASE_URL}/users/me/meetings`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            topic: meetingName,
            type: 2, // Scheduled meeting
            start_time: startTime,
            duration: duration,
            agenda: description || '',
            settings: {
                host_video: true,
                participant_video: true,
                join_before_host: true,
                mute_upon_entry: true,
                waiting_room: false,
                auto_recording: 'none'
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('Zoom Create Meeting Error:', data);
        throw new Error(data.message || 'Failed to create Zoom meeting');
    }

    return {
        id: data.id.toString(),
        joinUrl: data.join_url,
        password: data.password
    };
};

const deleteZoomMeeting = async (meetingId) => {
    if (!meetingId) return;

    const token = await getZoomToken();

    const response = await fetch(`${ZOOM_API_BASE_URL}/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok && response.status !== 404) {
        const data = await response.json();
        console.error('Zoom Delete Meeting Error:', data);
        throw new Error(data.message || 'Failed to delete Zoom meeting');
    }

    return true;
};

const endZoomMeeting = async (meetingId) => {
    if (!meetingId) return;

    const token = await getZoomToken();

    const response = await fetch(`${ZOOM_API_BASE_URL}/meetings/${meetingId}/status`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'end' })
    });

    if (!response.ok && response.status !== 404) {
        const data = await response.json();
        console.error('Zoom End Meeting Error:', data);
        throw new Error(data.message || 'Failed to end Zoom meeting');
    }

    return true;
};

module.exports = {
    createZoomMeeting,
    deleteZoomMeeting,
    endZoomMeeting
};
