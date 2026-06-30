from datetime import datetime
from app import db


class User(db.Model):
    """Registered user who can send broadcasts."""

    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=True)
    phone = db.Column(db.String(20), unique=True, nullable=True)
    name = db.Column(db.String(100), nullable=True)
    is_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # WhatsApp Cloud API credentials
    whatsapp_phone_id = db.Column(db.String(100), nullable=True)
    whatsapp_waba_id = db.Column(db.String(100), nullable=True)
    whatsapp_token = db.Column(db.Text, nullable=True)
    whatsapp_cloud_connected = db.Column(db.Boolean, default=False)

    # Relationships
    otps = db.relationship("OTP", backref="user", lazy=True, cascade="all, delete-orphan")
    contact_lists = db.relationship("ContactList", backref="owner", lazy=True, cascade="all, delete-orphan")
    broadcast_jobs = db.relationship("BroadcastJob", backref="owner", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "phone": self.phone,
            "name": self.name,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat(),
            "whatsapp_phone_id": self.whatsapp_phone_id,
            "whatsapp_waba_id": self.whatsapp_waba_id,
            "whatsapp_token": self.whatsapp_token,
            "whatsapp_cloud_connected": self.whatsapp_cloud_connected,
        }


class OTP(db.Model):
    """One-time password for authentication."""

    __tablename__ = "otps"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    code = db.Column(db.String(6), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ContactList(db.Model):
    """A named list of contacts uploaded via CSV."""

    __tablename__ = "contact_lists"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    total_contacts = db.Column(db.Integer, default=0)
    valid_contacts = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    contacts = db.relationship("Contact", backref="contact_list", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "total_contacts": self.total_contacts,
            "valid_contacts": self.valid_contacts,
            "created_at": self.created_at.isoformat(),
        }


class Contact(db.Model):
    """Individual contact within a contact list."""

    __tablename__ = "contacts"

    id = db.Column(db.Integer, primary_key=True)
    list_id = db.Column(db.Integer, db.ForeignKey("contact_lists.id"), nullable=False)
    name = db.Column(db.String(200), nullable=True)
    phone = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(255), nullable=True)
    is_valid = db.Column(db.Boolean, default=True)
    validation_error = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "is_valid": self.is_valid,
            "validation_error": self.validation_error,
        }


class BroadcastJob(db.Model):
    """A message broadcast job sent to a contact list."""

    __tablename__ = "broadcast_jobs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    contact_list_id = db.Column(db.Integer, db.ForeignKey("contact_lists.id"), nullable=True)
    list_name = db.Column(db.String(200), nullable=True)
    message_body = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), default="pending")  # pending, sending, completed, failed
    total = db.Column(db.Integer, default=0)
    sent = db.Column(db.Integer, default=0)
    failed = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)

    logs = db.relationship("BroadcastLog", backref="job", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "list_name": self.list_name,
            "message_body": self.message_body,
            "status": self.status,
            "total": self.total,
            "sent": self.sent,
            "failed": self.failed,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class BroadcastLog(db.Model):
    """Log entry for each individual message in a broadcast."""

    __tablename__ = "broadcast_logs"

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("broadcast_jobs.id"), nullable=False)
    contact_id = db.Column(db.Integer, db.ForeignKey("contacts.id"), nullable=True)
    contact_phone = db.Column(db.String(20), nullable=False)
    contact_name = db.Column(db.String(200), nullable=True)
    status = db.Column(db.String(20), default="pending")  # pending, sent, failed
    error_message = db.Column(db.Text, nullable=True)
    twilio_sid = db.Column(db.String(50), nullable=True)
    sent_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "contact_phone": self.contact_phone,
            "contact_name": self.contact_name,
            "status": self.status,
            "error_message": self.error_message,
            "sent_at": self.sent_at.isoformat() if self.sent_at else None,
        }
