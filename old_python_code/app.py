import os.path
import datetime
from flask import Flask, jsonify

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

app = Flask(__name__)

# Quyền truy cập: Chỉ đọc lịch
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

def get_calendar_service():
    creds = None
    # File token.json lưu trữ quyền truy cập của người dùng sau khi login thành công
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    
    # Nếu không có token hoặc token hết hạn, thực hiện login
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Lưu token cho lần chạy sau
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('calendar', v3, credentials=creds)

@app.route('/get-events', methods=['GET'])
def get_events():
    try:
        service = get_calendar_service()

        # Lấy thời điểm hiện tại
        now = datetime.datetime.utcnow().isoformat() + 'Z' # 'Z' nghĩa là UTC
        
        # Gọi API lấy 10 sự kiện sắp tới
        events_result = service.events().list(
            calendarId='primary', timeMin=now,
            maxResults=10, singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])

        if not events:
            return jsonify({"message": "Không có sự kiện nào sắp tới."})

        # Format lại dữ liệu trả về cho gọn
        results = []
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            results.append({
                "time": start,
                "summary": event.get('summary', 'Không có tiêu đề')
            })

        return jsonify(results)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)