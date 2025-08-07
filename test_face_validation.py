#!/usr/bin/env python3
"""
Simple test script for the face validation endpoint
"""
import requests
import json

# Configuration
API_BASE_URL = "http://localhost:8001"
FACE_VALIDATE_URL = f"{API_BASE_URL}/face/validate"

def test_face_validation():
    """Test the face validation endpoint"""
    
    # Test data - replace with actual S3 path of your split image
    test_data = {
        "s3_path": "test-images/person-and-id.jpg",  # Replace with actual S3 path
        "split_direction": "auto"  # Can be "vertical", "horizontal", or "auto"
    }
    
    print("Testing Face Validation Endpoint")
    print("=" * 50)
    print(f"URL: {FACE_VALIDATE_URL}")
    print(f"Request data: {json.dumps(test_data, indent=2)}")
    print()
    
    try:
        # Make the POST request
        response = requests.post(
            FACE_VALIDATE_URL,
            json=test_data,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        print(f"Status Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print()
        
        if response.status_code == 200:
            result = response.json()
            print("✅ SUCCESS!")
            print(f"Response: {json.dumps(result, indent=2)}")
            
            # Parse and display results nicely
            if result.get("success") and result.get("result"):
                validation_result = result["result"]
                print("\n📊 Validation Results:")
                print(f"  Split direction used: {validation_result.get('split_direction_used')}")
                print(f"  Faces match: {validation_result.get('faces_match')}")
                print(f"  Match confidence: {validation_result.get('match_confidence', 0):.2f}%")
                
                # Person half details
                person_half = validation_result.get('person_half', {})
                print(f"\n👤 Person Half:")
                print(f"  Faces detected: {person_half.get('faces_detected', 0)}")
                print(f"  Best face confidence: {person_half.get('best_face_confidence', 0):.2f}")
                print(f"  Labels detected: {person_half.get('labels_detected', [])}")
                
                # ID half details  
                id_half = validation_result.get('id_half', {})
                print(f"\n🆔 ID Half:")
                print(f"  Faces detected: {id_half.get('faces_detected', 0)}")
                print(f"  Best face confidence: {id_half.get('best_face_confidence', 0):.2f}")
                print(f"  Labels detected: {id_half.get('labels_detected', [])}")
                
                if validation_result.get('error_message'):
                    print(f"\n⚠️  Error: {validation_result.get('error_message')}")
            
        else:
            print("❌ ERROR!")
            print(f"Response: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ CONNECTION ERROR!")
        print("Make sure the backend server is running on http://localhost:8001")
        
    except requests.exceptions.Timeout:
        print("❌ TIMEOUT ERROR!")
        print("Request took longer than 30 seconds")
        
    except Exception as e:
        print(f"❌ UNEXPECTED ERROR: {str(e)}")

def test_health_check():
    """Test if the API is running"""
    try:
        response = requests.get(f"{API_BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ API is running")
            return True
        else:
            print(f"❌ API health check failed: {response.status_code}")
            return False
    except:
        print("❌ API is not responding")
        return False

if __name__ == "__main__":
    print("Face Validation API Test")
    print("=" * 50)
    
    # First check if API is running
    if not test_health_check():
        print("\nPlease start the backend server first:")
        print("cd sensai-ai/src && uvicorn api.main:app --reload --port 8001")
        exit(1)
    
    print()
    test_face_validation()
    
    print("\n" + "=" * 50)
    print("Test completed!")
    print("\nTo test with your own images:")
    print("1. Create a combined image with person on one half and ID card on the other half")
    print("2. Upload the combined image to your S3 bucket")
    print("3. Update the 's3_path' in this script")
    print("4. Make sure AWS credentials are configured")
    print("5. Optionally set 'split_direction' to 'vertical' or 'horizontal' instead of 'auto'")