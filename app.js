const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 1. Cấu hình OAuth2
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_DIR = path.join(__dirname, 'tokens'); // Thư mục lưu token của từng người

if (!fs.existsSync(TOKEN_DIR)) fs.mkdirSync(TOKEN_DIR);

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

// --- ROUTES ---

// 2. Tạo link đăng nhập cho thành viên trong team
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // Để lấy refresh_token dùng lâu dài
    scope: SCOPES,
    prompt: 'consent'
  });
  res.send(`<h1>Đăng nhập để Agent truy cập lịch của bạn:</h1><a href="${authUrl}">Nhấn vào đây để cấp quyền</a>`);
});

// 3. Callback để nhận code và lưu token theo email
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Lấy email người dùng để đặt tên file token
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    fs.writeFileSync(path.join(TOKEN_DIR, `${userEmail}.json`), JSON.stringify(tokens));
    res.send(`Thành công! Đã lưu token cho: ${userEmail}. Bây giờ Agent có thể xem lịch của bạn.`);
  } catch (error) {
    res.status(500).send('Lỗi khi lấy token: ' + error.message);
  }
});

// 4. API Lấy lịch của một người bất kỳ trong team (nếu đã có token)
app.get('/get-events/:email', async (req, res) => {
  const email = req.params.email;
  const tokenPath = path.join(TOKEN_DIR, `${email}.json`);

  if (!fs.existsSync(tokenPath)) {
    return res.status(404).json({ error: `Chưa có dữ liệu của ${email}. Hãy yêu cầu họ truy cập /auth trước.` });
  }

  try {
    const userTokens = JSON.parse(fs.readFileSync(tokenPath));
    const userClient = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    userClient.setCredentials(userTokens);

    const calendar = google.calendar({ version: 'v3', auth: userClient });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items;
    res.json({ user: email, events: events.map(e => ({ start: e.start.dateTime || e.start.date, title: e.summary })) });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi truy xuất lịch: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});