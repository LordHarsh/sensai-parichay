#!/usr/bin/env python3

import requests
import json

# Test data - using the exam/session IDs from the URL you provided
test_data = {
    "exam_id": "ca7cf870-56a0-4e03-b6b1-7ccf0a0b1bd4",
    "session_id": "ca7cf870-56a0-4e03-b6b1-7ccf0a0b1bd4_2_1754607321",
    "report_type": "comprehensive",
    "include_analytics": True,
    "include_questions": True,
    "include_video_info": True
}

# API endpoint
url = "http://localhost:8000/api/exam/generate-report"

# Headers (you'll need a valid user ID)
headers = {
    "Content-Type": "application/json",
    "x-user-id": "1"  # You may need to adjust this based on your auth system
}

print("Testing /generate-report endpoint...")
print(f"URL: {url}")
print(f"Data: {json.dumps(test_data, indent=2)}")

try:
    response = requests.post(url, json=test_data, headers=headers)
    
    print(f"\nResponse Status: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    
    if response.status_code == 200:
        # Save the PDF file
        with open("test_report.pdf", "wb") as f:
            f.write(response.content)
        print("✅ Report generated successfully! Saved as 'test_report.pdf'")
    else:
        print(f"❌ Error: {response.status_code}")
        try:
            error_detail = response.json()
            print(f"Error details: {json.dumps(error_detail, indent=2)}")
        except:
            print(f"Error text: {response.text}")
            
except requests.exceptions.RequestException as e:
    print(f"❌ Request failed: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")