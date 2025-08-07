#!/bin/bash

# Simple curl test for face validation endpoint
# Make sure to replace the S3 paths with actual image paths

echo "Testing Face Validation Endpoint with curl"
echo "=========================================="

# Test data - replace with actual S3 path
curl -X POST "http://localhost:8001/face/validate" \
     -H "Content-Type: application/json" \
     -d '{
       "s3_path": "test-images/person-and-id.jpg",
       "split_direction": "auto"
     }' \
     | python3 -m json.tool

echo ""
echo "=========================================="
echo "To test with your own images:"
echo "1. Create a combined image with person on one half and ID card on the other half"
echo "2. Upload the combined image to your S3 bucket"
echo "3. Replace the s3_path value above"
echo "4. Make sure the backend is running: cd sensai-ai/src && uvicorn api.main:app --reload --port 8001"
echo "5. Optionally set split_direction to 'vertical' or 'horizontal' instead of 'auto'"