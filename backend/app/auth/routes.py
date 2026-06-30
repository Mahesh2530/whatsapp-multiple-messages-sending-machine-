import random
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity,
)
from flask_mail import Message as MailMessage

from app import db, mail
from app.models import User, OTP

auth_bp = Blueprint("auth", __name__)


def generate_otp():
    """Generate a 6-digit OTP code."""
    return str(random.randint(100000, 999999))


def send_otp_email(email, otp_code):
    """Send OTP code via email."""
    try:
        msg = MailMessage(
            subject="Your WhatsApp Broadcaster Verification Code",
            recipients=[email],
            html=f"""
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto;
                        background: linear-gradient(135deg, #0a0f1e, #1a1f3e); padding: 40px;
                        border-radius: 16px; color: #f1f5f9;">
                <h2 style="margin: 0 0 8px; color: #818cf8;">WhatsApp Broadcaster</h2>
                <p style="color: #94a3b8; margin: 0 0 24px;">Your verification code</p>
                <div style="background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3);
                            border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #a5b4fc;">
                        {otp_code}
                    </span>
                </div>
                <p style="color: #64748b; font-size: 14px; margin: 0;">
                    This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
                </p>
            </div>
            """,
        )
        mail.send(msg)
        return True
    except Exception as e:
        print(f"Email send error: {e}")
        return False


# ── Send OTP ─────────────────────────────────────────────────────

@auth_bp.route("/send-otp", methods=["POST"])
def send_otp():
    data = request.get_json()
    email = data.get("email", "").strip().lower() if data.get("email") else None
    phone = data.get("phone", "").strip() if data.get("phone") else None

    if not email and not phone:
        return jsonify({"error": "Email or phone number is required"}), 400

    # Find or create user
    user = None
    if email:
        user = User.query.filter_by(email=email).first()
        if not user:
            user = User(email=email)
            db.session.add(user)
            db.session.commit()
    elif phone:
        user = User.query.filter_by(phone=phone).first()
        if not user:
            user = User(phone=phone)
            db.session.add(user)
            db.session.commit()

    # Invalidate old unused OTPs
    OTP.query.filter_by(user_id=user.id, used=False).update({"used": True})
    db.session.commit()

    # Generate new OTP
    otp_code = generate_otp()
    otp = OTP(
        user_id=user.id,
        code=otp_code,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.session.add(otp)
    db.session.commit()

    # Send OTP
    if email:
        sent = send_otp_email(email, otp_code)
        if not sent:
            # In development, still return success but log the OTP
            print(f"[DEV] OTP for {email}: {otp_code}")
    else:
        # For phone OTP — in development, just log it
        print(f"[DEV] OTP for {phone}: {otp_code}")

    return jsonify({
        "message": "OTP sent successfully",
        "dev_otp": otp_code,  # Remove in production!
    }), 200


# ── Verify OTP ───────────────────────────────────────────────────

@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json()
    email = data.get("email", "").strip().lower() if data.get("email") else None
    phone = data.get("phone", "").strip() if data.get("phone") else None
    code = data.get("code", "").strip()

    if not code:
        return jsonify({"error": "OTP code is required"}), 400
    if not email and not phone:
        return jsonify({"error": "Email or phone is required"}), 400

    # Find user
    if email:
        user = User.query.filter_by(email=email).first()
    else:
        user = User.query.filter_by(phone=phone).first()

    if not user:
        return jsonify({"error": "User not found"}), 404

    # Check OTP
    otp = (
        OTP.query.filter_by(user_id=user.id, code=code, used=False)
        .order_by(OTP.created_at.desc())
        .first()
    )

    if not otp:
        return jsonify({"error": "Invalid OTP code"}), 401

    if otp.expires_at < datetime.utcnow():
        otp.used = True
        db.session.commit()
        return jsonify({"error": "OTP has expired"}), 401

    # Mark OTP as used & verify user
    otp.used = True
    user.is_verified = True
    db.session.commit()

    # Create JWT token
    access_token = create_access_token(identity=str(user.id))

    return jsonify({
        "message": "Verified successfully",
        "access_token": access_token,
        "user": user.to_dict(),
    }), 200


# ── Get current user ────────────────────────────────────────────

@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def get_me():
    user_id = get_jwt_identity()
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": user.to_dict()}), 200


# ── Update profile ──────────────────────────────────────────────

@auth_bp.route("/profile", methods=["PUT"])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    user = User.query.get(int(user_id))
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if "name" in data:
        user.name = data["name"].strip() if data["name"] else None
    
    # WhatsApp Cloud API credential fields
    if "whatsapp_phone_id" in data:
        user.whatsapp_phone_id = data["whatsapp_phone_id"]
    if "whatsapp_waba_id" in data:
        user.whatsapp_waba_id = data["whatsapp_waba_id"]
    if "whatsapp_token" in data:
        user.whatsapp_token = data["whatsapp_token"]
    if "whatsapp_cloud_connected" in data:
        user.whatsapp_cloud_connected = data["whatsapp_cloud_connected"]

    db.session.commit()

    return jsonify({"user": user.to_dict()}), 200
