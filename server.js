const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- משתני סביבה (מוגדרים ב-Render Dashboard) ---
const AUTH_KEY = process.env.API_SECRET_KEY || 'my_super_secret_token_123';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_PHONE = process.env.TWILIO_FROM_PHONE; // המספר ששכרת ב-Twilio
const OWNER_PHONE = process.env.OWNER_PHONE;             // הנייד האישי שלך (+9725...)

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// --- מצב מערכת בזיכרון (In-Memory State) ---
let bikeState = {
  isAlarm: false,
  alarmReason: null,
  lat: 32.0853,
  lng: 34.7818,
  speed: 0.0,
  batteryPercent: 96,
  lastSeen: new Date().toISOString(),
  lastKeepAlive: new Date().toISOString(),
  deviceStatus: 'DEEP_SLEEP'
};

// Middleware פשוט לאימות הבקר
function authenticate(req, res, next) {
  const token = req.headers['x-api-key'] || req.query.apiKey;
  if (token !== AUTH_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
}

// ----------------------------------------------------
// 1. קריאת סטטוס על ידי הדשבורד באתר
// ----------------------------------------------------
app.get('/api/status', authenticate, (req, res) => {
  res.json({
    success: true,
    data: bikeState
  });
});

// ----------------------------------------------------
// 2. קבלת אות Keep-Alive מה-LilyGO (פעם ביממה)
// ----------------------------------------------------
app.post('/api/keepalive', authenticate, (req, res) => {
  const { battery } = req.body;

  bikeState.lastKeepAlive = new Date().toISOString();
  bikeState.lastSeen = bikeState.lastKeepAlive;
  if (battery !== undefined) bikeState.batteryPercent = Number(battery);
  bikeState.deviceStatus = 'DEEP_SLEEP';

  console.log(`[Keep-Alive Received] Battery: ${bikeState.batteryPercent}% at ${bikeState.lastKeepAlive}`);
  res.json({ success: true, message: 'Keep-alive acknowledged' });
});

// ----------------------------------------------------
// 3. קבלת התראת גניבה ושידור מיקום חי (Alarm / Tracker)
// ----------------------------------------------------
app.post('/api/alarm', authenticate, async (req, res) => {
  const { event, lat, lng, speed, battery } = req.body;

  const isFirstTrigger = !bikeState.isAlarm;
  bikeState.isAlarm = true;
  bikeState.alarmReason = event || 'DISC_CUT_DETECTED';
  bikeState.deviceStatus = 'ALARM_ACTIVE';
  bikeState.lastSeen = new Date().toISOString();

  if (lat && lng) {
    bikeState.lat = Number(lat);
    bikeState.lng = Number(lng);
  }
  if (speed !== undefined) bikeState.speed = Number(speed);
  if (battery !== undefined) bikeState.batteryPercent = Number(battery);

  console.warn(`[THEFT ALERT TRIGGERED] Coords: ${bikeState.lat}, ${bikeState.lng}`);

  // הזנקת שיחת טלפון עוקפת שקט דרך Twilio באירוע הראשון
  if (isFirstTrigger && twilioClient && OWNER_PHONE && TWILIO_FROM_PHONE) {
    try {
      const twimlMessage = `
        <Response>
          <Say language="he-IL" voice="Polly.Avri">
            התראת חירום! זוהה חיתוך דיסק במנעול האופניים שלך. היכנס מיד לדשבורד לצפייה במיקום ה-GPS.
          </Say>
        </Response>
      `;

      const call = await twilioClient.calls.create({
        twiml: twimlMessage,
        to: OWNER_PHONE,
        from: TWILIO_FROM_PHONE
      });

      console.log(`[Twilio Call Dispatched] Call SID: ${call.sid}`);
    } catch (err) {
      console.error('[Twilio Call Failed]:', err.message);
    }
  }

  res.json({ success: true, message: 'Alarm received and processed' });
});

// ----------------------------------------------------
// 4. איפוס אזעקה ע"י הבעלים (Dismiss)
// ----------------------------------------------------
app.post('/api/dismiss', authenticate, (req, res) => {
  bikeState.isAlarm = false;
  bikeState.alarmReason = null;
  bikeState.deviceStatus = 'DEEP_SLEEP';
  bikeState.speed = 0.0;
  console.log('[Alarm Dismissed by Owner]');
  res.json({ success: true, message: 'Alarm reset successfully' });
});

app.listen(PORT, () => {
  console.log(`BikeLock Sentinel Server running on port ${PORT}`);
});
