import os
import boto3
import traceback
import io
import uuid
from PIL import Image
from fastapi import APIRouter, HTTPException
from botocore.exceptions import ClientError, NoCredentialsError
from typing import Tuple, Dict, List
from api.models import (
    ValidateFaceRequest, 
    ValidateFaceResponse, 
    FaceValidationResult,
    ImageHalfValidation,
    UploadVerificationRequest,
    UploadVerificationResponse,
    DirectUploadVerificationRequest,
    VerifyIdentityRequest,
    VerifyIdentityResponse
)
from api.utils.logging import logger
import dotenv
from api.settings import settings

router = APIRouter()
dotenv.load_dotenv()

# Label keywords for identifying content types
PERSON_LABELS = {'Person', 'Human', 'Face', 'Head', 'Portrait'}
ID_LABELS = {'Id Cards', 'Driver License', 'Passport', 'Document', 'Text', 'Paper'}


def get_rekognition_client():
    """Initialize AWS Rekognition client"""
    try:
        return boto3.client(
            'rekognition',
            region_name='ap-south-1'  # Using same region as S3
        )
    except NoCredentialsError:
        raise HTTPException(
            status_code=500,
            detail="AWS credentials not configured"
        )


def get_s3_client():
    """Initialize S3 client"""
    try:
        return boto3.client(
            's3',
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
            region_name='ap-south-1'
        )
    except NoCredentialsError:
        raise HTTPException(
            status_code=500,
            detail="AWS credentials not configured"
        )


async def download_image_from_s3(bucket_name: str, s3_key: str) -> bytes:
    """Download image from S3 and return bytes"""
    try:
        s3_client = get_s3_client()
        response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        print(f"Downloaded image from S3: {s3_key}")
        return response['Body'].read()
    except ClientError as e:
        logger.error(f"Error downloading image from S3: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Error downloading image: {str(e)}"
        )


async def split_image(image_bytes: bytes, direction: str) -> Tuple[bytes, bytes]:
    """Split image into two halves based on direction"""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        width, height = image.size
        
        if direction == "vertical":
            # Split left and right
            mid_x = width // 2
            left_half = image.crop((0, 0, mid_x, height))
            right_half = image.crop((mid_x, 0, width, height))
            
            # Convert to bytes
            left_bytes = io.BytesIO()
            right_bytes = io.BytesIO()
            left_half.save(left_bytes, format='JPEG')
            right_half.save(right_bytes, format='JPEG')
            
            return left_bytes.getvalue(), right_bytes.getvalue()
            
        elif direction == "horizontal":
            # Split top and bottom
            mid_y = height // 2
            top_half = image.crop((0, 0, width, mid_y))
            bottom_half = image.crop((0, mid_y, width, height))
            
            # Convert to bytes
            top_bytes = io.BytesIO()
            bottom_bytes = io.BytesIO()
            top_half.save(top_bytes, format='JPEG')
            bottom_half.save(bottom_bytes, format='JPEG')
            
            return top_bytes.getvalue(), bottom_bytes.getvalue()
            
    except Exception as e:
        logger.error(f"Error splitting image: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Error processing image: {str(e)}"
        )


async def upload_temp_image_to_s3(bucket_name: str, image_bytes: bytes, prefix: str) -> str:
    """Upload temporary image to S3 and return key"""
    try:
        s3_client = get_s3_client()
        temp_key = f"temp/{prefix}_{uuid.uuid4()}.jpg"
        
        s3_client.put_object(
            Bucket=bucket_name,
            Key=temp_key,
            Body=image_bytes,
            ContentType='image/jpeg'
        )
        
        return temp_key
    except ClientError as e:
        logger.error(f"Error uploading temp image to S3: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Error uploading temporary image: {str(e)}"
        )


async def cleanup_temp_images(bucket_name: str, keys: List[str]):
    """Clean up temporary images from S3"""
    try:
        s3_client = get_s3_client()
        for key in keys:
            s3_client.delete_object(Bucket=bucket_name, Key=key)
    except Exception as e:
        logger.warning(f"Failed to cleanup temp images: {str(e)}")


async def detect_labels_in_image(rekognition_client, bucket_name: str, s3_key: str) -> Dict[str, float]:
    """Detect labels in image and return label confidence mapping"""
    try:
        response = rekognition_client.detect_labels(
            Image={
                'S3Object': {
                    'Bucket': bucket_name,
                    'Name': s3_key
                }
            },
            MaxLabels=20,
            MinConfidence=70.0
        )
        
        labels = {}
        for label in response['Labels']:
            labels[label['Name']] = label['Confidence']
            
        return labels
        
    except ClientError as e:
        logger.error(f"Error detecting labels: {str(e)}")
        return {}


async def detect_faces_in_image(rekognition_client, bucket_name: str, s3_key: str):
    """Detect faces in an image stored in S3"""
    try:
        response = rekognition_client.detect_faces(
            Image={
                'S3Object': {
                    'Bucket': bucket_name,
                    'Name': s3_key
                }
            },
            Attributes=['DEFAULT']
        )
        return response['FaceDetails']
    except ClientError as e:
        logger.error(f"Error detecting faces: {str(e)}")
        return []


async def compare_faces_by_bytes(rekognition_client, source_bytes: bytes, target_bytes: bytes):
    """Compare faces between two images using bytes"""
    try:
        response = rekognition_client.compare_faces(
            SourceImage={'Bytes': source_bytes},
            TargetImage={'Bytes': target_bytes},
            SimilarityThreshold=70.0
        )
        
        if response['FaceMatches']:
            best_match = max(response['FaceMatches'], key=lambda x: x['Similarity'])
            return True, best_match['Similarity']
        else:
            return False, 0.0
            
    except ClientError as e:
        logger.error(f"Error comparing faces: {str(e)}")
        return False, 0.0


async def analyze_image_half(rekognition_client, bucket_name: str, s3_key: str) -> ImageHalfValidation:
    """Analyze a single half of the image for content and faces"""
    
    # Detect labels
    labels = await detect_labels_in_image(rekognition_client, bucket_name, s3_key)
    
    # Detect faces
    faces = await detect_faces_in_image(rekognition_client, bucket_name, s3_key)
    
    # Determine content type
    detected_labels = set(labels.keys())
    is_person_half = bool(PERSON_LABELS.intersection(detected_labels))
    is_id_half = bool(ID_LABELS.intersection(detected_labels))
    
    # Get best face confidence
    best_face_confidence = None
    if faces:
        best_face_confidence = max(face['Confidence'] for face in faces)
    
    return ImageHalfValidation(
        labels_detected=list(labels.keys()),
        label_confidences=labels,
        faces_detected=len(faces),
        best_face_confidence=best_face_confidence,
        is_person_half=is_person_half,
        is_id_half=is_id_half
    )


async def determine_best_split(rekognition_client, bucket_name: str, 
                             half1_key: str, half2_key: str, 
                             half3_key: str, half4_key: str) -> Tuple[str, str, str]:
    """Determine the best split direction and which half is person vs ID"""
    
    # Analyze all halves
    half1 = await analyze_image_half(rekognition_client, bucket_name, half1_key)  # left/top
    half2 = await analyze_image_half(rekognition_client, bucket_name, half2_key)  # right/bottom
    half3 = await analyze_image_half(rekognition_client, bucket_name, half3_key)  # left/top (horizontal)
    half4 = await analyze_image_half(rekognition_client, bucket_name, half4_key)  # right/bottom (horizontal)
    
    # Score vertical split
    vertical_score = 0
    if (half1.is_person_half and half2.is_id_half) or (half1.is_id_half and half2.is_person_half):
        vertical_score += 10
    vertical_score += half1.faces_detected + half2.faces_detected
    
    # Score horizontal split  
    horizontal_score = 0
    if (half3.is_person_half and half4.is_id_half) or (half3.is_id_half and half4.is_person_half):
        horizontal_score += 10
    horizontal_score += half3.faces_detected + half4.faces_detected
    
    if vertical_score >= horizontal_score:
        # Use vertical split
        if half1.is_person_half and half2.is_id_half:
            return "vertical", half1_key, half2_key
        elif half1.is_id_half and half2.is_person_half:
            return "vertical", half2_key, half1_key
        else:
            # Default: assume first half is person
            return "vertical", half1_key, half2_key
    else:
        # Use horizontal split
        if half3.is_person_half and half4.is_id_half:
            return "horizontal", half3_key, half4_key
        elif half3.is_id_half and half4.is_person_half:
            return "horizontal", half4_key, half3_key
        else:
            # Default: assume first half is person
            return "horizontal", half3_key, half4_key


@router.post("/validate", response_model=ValidateFaceResponse)
async def validate_face(request: ValidateFaceRequest) -> ValidateFaceResponse:
    """
    Validate face using split-image approach:
    1. Download and split the image
    2. Analyze each half for content type (person vs ID)  
    3. Compare faces between the halves
    """
    
    if not settings.s3_bucket_name:
        raise HTTPException(
            status_code=500,
            detail="S3 bucket name not configured"
        )
    
    temp_keys = []
    
    try:
        rekognition_client = get_rekognition_client()
        bucket_name = settings.s3_bucket_name
        
        # Step 1: Download original image
        logger.info(f"Downloading image: {request.s3_path}")
        image_bytes = await download_image_from_s3(bucket_name, request.s3_path)
        
        # Step 2: Create vertical split only
        left_bytes, right_bytes = await split_image(image_bytes, "vertical")
        print("Image split vertically successfully")
        
        # Step 3: Upload temp images (left = person, right = ID)
        left_key = await upload_temp_image_to_s3(bucket_name, left_bytes, "left")
        right_key = await upload_temp_image_to_s3(bucket_name, right_bytes, "right")
        print("Temporary images uploaded to S3")
        temp_keys = [left_key, right_key]
        
        # Step 4: Analyze both halves (assume left = person, right = ID)
        person_half = await analyze_image_half(rekognition_client, bucket_name, left_key)
        id_half = await analyze_image_half(rekognition_client, bucket_name, right_key)
        print(f"Person half (left): faces={person_half.faces_detected}, ID half (right): faces={id_half.faces_detected}")
        
        # Step 5: Compare faces
        faces_match = False
        match_confidence = 0.0
        
        if person_half.faces_detected > 0 and id_half.faces_detected > 0:
            print("Comparing faces between person and ID halves")
            faces_match, match_confidence = await compare_faces_by_bytes(
                rekognition_client, left_bytes, right_bytes
            )
            print(f"Faces match: {faces_match}, Confidence: {match_confidence:.2f}%")
        
        # Step 6: Cleanup temp files
        await cleanup_temp_images(bucket_name, temp_keys)
        
        # Step 8: Generate error message if needed
        error_message = None
        if not faces_match:
            if person_half.faces_detected == 0:
                error_message = "No face detected in person half"
            elif id_half.faces_detected == 0:
                error_message = "No face detected in ID half"
            else:
                error_message = f"Faces do not match (confidence: {match_confidence:.2f}%)"
        
        return ValidateFaceResponse(
            success=True,
            result=FaceValidationResult(
                split_direction_used="vertical",
                person_half=person_half,
                id_half=id_half,
                faces_match=faces_match,
                match_confidence=match_confidence,
                error_message=error_message
            )
        )
        
    except HTTPException:
        # Cleanup and re-raise HTTP exceptions
        await cleanup_temp_images(settings.s3_bucket_name, temp_keys)
        raise
    except Exception as e:
        # Cleanup temp files on error
        await cleanup_temp_images(settings.s3_bucket_name, temp_keys)
        
        logger.error(f"Unexpected error in face validation: {str(e)}")
        logger.error(traceback.format_exc())
        
        return ValidateFaceResponse(
            success=False,
            error=f"Internal server error: {str(e)}"
        )


@router.post("/upload-verification", response_model=UploadVerificationResponse)
async def upload_verification(request: UploadVerificationRequest) -> UploadVerificationResponse:
    """
    Generate a presigned URL for uploading a verification image to S3
    """
    if not settings.s3_bucket_name:
        raise HTTPException(
            status_code=500,
            detail="S3 bucket name not configured"
        )
    
    try:
        s3_client = get_s3_client()
        bucket_name = settings.s3_bucket_name
        
        # Generate unique S3 key for verification image
        verification_key = f"verification/{request.exam_id}/{uuid.uuid4()}.jpg"
        
        # Generate presigned URL for upload
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': bucket_name,
                'Key': verification_key,
                'ContentType': request.file_type,
                'ACL': 'private'
            },
            ExpiresIn=300  # 5 minutes
        )
        
        logger.info(f"Generated presigned URL for verification upload: {verification_key}")
        
        return UploadVerificationResponse(
            success=True,
            presigned_url=presigned_url,
            s3_key=verification_key
        )
        
    except Exception as e:
        logger.error(f"Failed to generate presigned URL: {str(e)}")
        logger.error(traceback.format_exc())
        
        return UploadVerificationResponse(
            success=False,
            error=f"Failed to generate upload URL: {str(e)}"
        )


@router.post("/upload-verification-direct", response_model=UploadVerificationResponse)
async def upload_verification_direct(request: DirectUploadVerificationRequest) -> UploadVerificationResponse:
    """
    Upload verification image directly to S3 via backend (bypasses CORS)
    """
    if not settings.s3_bucket_name:
        raise HTTPException(
            status_code=500,
            detail="S3 bucket name not configured"
        )
    
    try:
        import base64
        s3_client = get_s3_client()
        bucket_name = settings.s3_bucket_name
        
        # Decode base64 image
        image_data = request.image_data
        if image_data.startswith('data:image/'):
            # Remove data URL prefix
            image_data = image_data.split(',')[1]
        
        image_bytes = base64.b64decode(image_data)
        
        # Generate unique S3 key for verification image
        verification_key = f"verification/{request.exam_id}/{uuid.uuid4()}.jpg"
        
        # Upload directly to S3
        s3_client.put_object(
            Bucket=bucket_name,
            Key=verification_key,
            Body=image_bytes,
            ContentType='image/jpeg',
            ACL='private'
        )
        
        logger.info(f"Direct upload successful: {verification_key}")
        
        return UploadVerificationResponse(
            success=True,
            s3_key=verification_key
        )
        
    except Exception as e:
        logger.error(f"Failed to upload image directly: {str(e)}")
        logger.error(traceback.format_exc())
        
        return UploadVerificationResponse(
            success=False,
            error=f"Failed to upload image: {str(e)}"
        )


@router.post("/verify-identity", response_model=VerifyIdentityResponse)
async def verify_identity(request: VerifyIdentityRequest) -> VerifyIdentityResponse:
    """
    Verify identity by comparing verification image with reference image
    """
    if not settings.s3_bucket_name:
        raise HTTPException(
            status_code=500,
            detail="S3 bucket name not configured"
        )
    
    try:
        rekognition_client = get_rekognition_client()
        bucket_name = settings.s3_bucket_name
        
        # Download both images from S3
        logger.info(f"Downloading verification image: {request.verification_s3_key}")
        verification_bytes = await download_image_from_s3(bucket_name, request.verification_s3_key)
        
        logger.info(f"Downloading reference image: {request.reference_s3_key}")
        reference_bytes = await download_image_from_s3(bucket_name, request.reference_s3_key)
        
        # Compare faces between verification and reference images
        faces_match, confidence_score = await compare_faces_by_bytes(
            rekognition_client, verification_bytes, reference_bytes
        )
        
        logger.info(f"Face comparison result: match={faces_match}, confidence={confidence_score:.2f}%")
        
        # Determine verification result
        verified = faces_match and confidence_score >= 70.0  # Minimum 70% confidence
        
        error_message = None
        if not verified and not faces_match:
            error_message = f"Face verification failed - faces do not match (confidence: {confidence_score:.2f}%)"
        elif not verified:
            error_message = f"Face verification failed - insufficient confidence (confidence: {confidence_score:.2f}%)"
        
        return VerifyIdentityResponse(
            success=True,
            verified=verified,
            confidence_score=confidence_score,
            error_message=error_message
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions (from download_image_from_s3)
        raise
    except Exception as e:
        logger.error(f"Unexpected error in identity verification: {str(e)}")
        logger.error(traceback.format_exc())
        
        return VerifyIdentityResponse(
            success=False,
            verified=False,
            error=f"Internal server error: {str(e)}"
        )