import io
import pandas as pd
import phonenumbers

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app import db
from app.models import ContactList, Contact

contacts_bp = Blueprint("contacts", __name__)


def validate_phone_number(phone_str, default_region="IN"):
    """Validate and normalize a phone number. Returns (normalized, error)."""
    try:
        phone_str = str(phone_str).strip()
        if not phone_str.startswith("+"):
            phone_str = "+" + phone_str if phone_str.startswith("91") else "+91" + phone_str

        parsed = phonenumbers.parse(phone_str, default_region)
        if not phonenumbers.is_valid_number(parsed):
            return None, "Invalid phone number"
        normalized = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        return normalized, None
    except phonenumbers.NumberParseException:
        return None, "Cannot parse phone number"


# ── Upload & validate CSV ────────────────────────────────────────

@contacts_bp.route("/upload", methods=["POST"])
@jwt_required()
def upload_csv():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    filename = file.filename.lower()

    allowed_exts = (".csv", ".xlsx", ".xls")
    if not any(filename.endswith(ext) for ext in allowed_exts):
        return jsonify({"error": "Only CSV and Excel (.xlsx, .xls) files are accepted"}), 400

    try:
        if filename.endswith(".csv"):
            content = file.read().decode("utf-8")
            df = pd.read_csv(io.StringIO(content))
        else:
            # Excel file
            df = pd.read_excel(io.BytesIO(file.read()), engine="openpyxl")
    except Exception as e:
        return jsonify({"error": f"Failed to parse file: {str(e)}"}), 400

    # Detect phone column
    phone_col = None
    for col in df.columns:
        if col.lower() in ("phone", "phone_number", "mobile", "number", "contact", "whatsapp"):
            phone_col = col
            break

    if not phone_col:
        return jsonify({
            "error": "CSV must contain a column named 'phone', 'phone_number', 'mobile', 'number', 'contact', or 'whatsapp'"
        }), 400

    # Detect name column (optional)
    name_col = None
    for col in df.columns:
        if col.lower() in ("name", "full_name", "customer_name", "contact_name"):
            name_col = col
            break

    # Detect email column (optional)
    email_col = None
    for col in df.columns:
        if col.lower() in ("email", "email_address", "mail"):
            email_col = col
            break

    # Validate each row
    results = []
    seen_phones = set()
    valid_count = 0
    duplicate_count = 0
    invalid_count = 0

    for idx, row in df.iterrows():
        raw_phone = str(row[phone_col]).strip() if pd.notna(row[phone_col]) else ""
        name = str(row[name_col]).strip() if name_col and pd.notna(row.get(name_col)) else ""
        email = str(row[email_col]).strip() if email_col and pd.notna(row.get(email_col)) else ""

        if not raw_phone or raw_phone == "nan":
            results.append({
                "row": idx + 1,
                "name": name,
                "phone": raw_phone,
                "email": email,
                "is_valid": False,
                "error": "Empty phone number",
            })
            invalid_count += 1
            continue

        normalized, error = validate_phone_number(raw_phone)

        if error:
            results.append({
                "row": idx + 1,
                "name": name,
                "phone": raw_phone,
                "email": email,
                "is_valid": False,
                "error": error,
            })
            invalid_count += 1
            continue

        if normalized in seen_phones:
            results.append({
                "row": idx + 1,
                "name": name,
                "phone": normalized,
                "email": email,
                "is_valid": False,
                "error": "Duplicate phone number",
            })
            duplicate_count += 1
            continue

        seen_phones.add(normalized)
        results.append({
            "row": idx + 1,
            "name": name,
            "phone": normalized,
            "email": email,
            "is_valid": True,
            "error": None,
        })
        valid_count += 1

    return jsonify({
        "total": len(results),
        "valid": valid_count,
        "invalid": invalid_count,
        "duplicates": duplicate_count,
        "contacts": results,
    }), 200


# ── Save validated contacts ─────────────────────────────────────

@contacts_bp.route("/save", methods=["POST"])
@jwt_required()
def save_contacts():
    user_id = get_jwt_identity()
    data = request.get_json()

    list_name = data.get("list_name", "").strip()
    contacts_data = data.get("contacts", [])

    if not list_name:
        return jsonify({"error": "List name is required"}), 400
    if not contacts_data:
        return jsonify({"error": "No contacts to save"}), 400

    # Create contact list
    contact_list = ContactList(
        user_id=int(user_id),
        name=list_name,
        total_contacts=len(contacts_data),
        valid_contacts=sum(1 for c in contacts_data if c.get("is_valid", True)),
    )
    db.session.add(contact_list)
    db.session.flush()

    # Add contacts
    for c in contacts_data:
        if c.get("is_valid", True):
            contact = Contact(
                list_id=contact_list.id,
                name=c.get("name", ""),
                phone=c.get("phone", ""),
                email=c.get("email", ""),
                is_valid=True,
            )
            db.session.add(contact)

    db.session.commit()

    return jsonify({
        "message": "Contacts saved successfully",
        "list": contact_list.to_dict(),
    }), 201


# ── Get all contact lists ───────────────────────────────────────

@contacts_bp.route("/lists", methods=["GET"])
@jwt_required()
def get_lists():
    user_id = get_jwt_identity()
    lists = ContactList.query.filter_by(user_id=int(user_id)).order_by(ContactList.created_at.desc()).all()
    return jsonify({"lists": [cl.to_dict() for cl in lists]}), 200


# ── Get contacts in a list ──────────────────────────────────────

@contacts_bp.route("/lists/<int:list_id>", methods=["GET"])
@jwt_required()
def get_list_contacts(list_id):
    user_id = get_jwt_identity()
    contact_list = ContactList.query.filter_by(id=list_id, user_id=int(user_id)).first()
    if not contact_list:
        return jsonify({"error": "Contact list not found"}), 404

    contacts = Contact.query.filter_by(list_id=list_id, is_valid=True).all()
    return jsonify({
        "list": contact_list.to_dict(),
        "contacts": [c.to_dict() for c in contacts],
    }), 200


# ── Delete a contact list ───────────────────────────────────────

@contacts_bp.route("/lists/<int:list_id>", methods=["DELETE"])
@jwt_required()
def delete_list(list_id):
    user_id = get_jwt_identity()
    contact_list = ContactList.query.filter_by(id=list_id, user_id=int(user_id)).first()
    if not contact_list:
        return jsonify({"error": "Contact list not found"}), 404

    db.session.delete(contact_list)
    db.session.commit()

    return jsonify({"message": "Contact list deleted"}), 200
