const XLSX = require('xlsx');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ── Lazy AI client — only instantiated when an AI call is needed ──
let aiClient = null;
let aiInitAttempted = false;

function getAIClient() {
  if (aiInitAttempted) return aiClient;
  aiInitAttempted = true;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn('[SmartDiscovery] GEMINI_API_KEY not set — AI fallback disabled.');
    return null;
  }
  try {
    const { GoogleGenAI } = require('@google/genai');
    aiClient = new GoogleGenAI({ apiKey: key });
    console.log('[SmartDiscovery] Gemini AI client initialised.');
  } catch (e) {
    console.error('[SmartDiscovery] Failed to init Gemini:', e.message);
  }
  return aiClient;
}

const nameRegex = /name|full[_ ]?name|person|contact|customer|student|leader|employee|parent/i;
const phoneRegex = /phone|mobile|contact|whatsapp|number|tel/i;

function cleanPhone(raw) {
  return String(raw || '').replace(/[\s\-().+]/g, '');
}

function isValidPhonePattern(rawPhone) {
  const cleaned = cleanPhone(rawPhone);
  if (!/^\d{7,15}$/.test(cleaned)) return false;
  try {
    const p = parsePhoneNumberFromString(String(rawPhone), 'IN');
    if (p && p.isValid()) return true;
  } catch(e) {}
  return true; // simple fallback
}

function normalizePhone(rawPhone) {
  const cleaned = cleanPhone(rawPhone);
  try {
    const p = parsePhoneNumberFromString(String(rawPhone), 'IN');
    if (p && p.isValid()) return p.number.replace('+', '');
  } catch(e) {}
  let p = cleaned;
  if (p.startsWith('0')) p = '91' + p.slice(1);
  if (p.length === 10) p = '91' + p;
  return p;
}

// ── HEURISTIC DETECTION ─────────────────────────────────────
function detectGroupsHeuristic(headers, sampleRows) {
  const groups = [];
  
  // Find all possible name and phone columns
  const nameCols = [];
  const phoneCols = [];

  headers.forEach((h, idx) => {
    if (nameRegex.test(h)) nameCols.push({ header: h, idx });
    else if (phoneRegex.test(h)) {
      // Validate with sample rows
      let validCount = 0;
      let total = 0;
      sampleRows.forEach(row => {
        const val = row[h];
        if (val) {
          total++;
          if (isValidPhonePattern(val)) validCount++;
        }
      });
      if (total === 0 || (validCount / total) > 0.5) {
        phoneCols.push({ header: h, idx });
      }
    }
  });

  if (phoneCols.length === 0) return [];

  // Group pairs (e.g. Leader Name, Leader Phone)
  // If only 1 phone and 1 name, it's one group.
  if (phoneCols.length === 1) {
    groups.push({
      label: 'All Contacts',
      nameCol: nameCols.length > 0 ? nameCols[0].header : null,
      phoneCol: phoneCols[0].header,
      confidence: 95
    });
    return groups;
  }

  // Try to match prefixes for multiple groups
  const usedPhones = new Set();
  nameCols.forEach(nc => {
    const prefixMatch = nc.header.match(/^(.*?)(name|full name|person)/i);
    const prefix = prefixMatch ? prefixMatch[1].trim() : '';
    
    // Find matching phone column
    const pc = phoneCols.find(p => !usedPhones.has(p.header) && p.header.toLowerCase().includes(prefix.toLowerCase()));
    
    if (pc) {
      groups.push({
        label: prefix ? prefix.trim() : 'Group',
        nameCol: nc.header,
        phoneCol: pc.header,
        confidence: 90
      });
      usedPhones.add(pc.header);
    }
  });

  // Any remaining phone cols get their own group
  phoneCols.forEach(pc => {
    if (!usedPhones.has(pc.header)) {
      groups.push({
        label: pc.header,
        nameCol: null,
        phoneCol: pc.header,
        confidence: 80
      });
    }
  });

  return groups;
}

// ── AI FALLBACK ─────────────────────────────────────────────
async function detectGroupsAI(headers, sampleRows) {
  const client = getAIClient();
  if (!client) return [];
  const prompt = `
I have a spreadsheet with the following headers:
${JSON.stringify(headers)}

Here are a few sample rows:
${JSON.stringify(sampleRows.slice(0,3))}

Please identify all columns that represent phone numbers and their corresponding names (if any).
Return ONLY a valid JSON array of objects with this exact structure:
[
  { "label": "Group Name (e.g. Leader or Member 1)", "nameCol": "Header for Name (or null)", "phoneCol": "Header for Phone", "confidence": <number 0-100> }
]
`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text);
  } catch(e) {
    console.error("AI Fallback failed:", e.message);
    return [];
  }
}

// ── MAIN PROCESSOR ──────────────────────────────────────────
async function processSpreadsheet(buffer, originalName) {
  const ext = require('path').extname(originalName).toLowerCase();
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return { 
      detectedGroups: [], suggestedNameColumn: "", suggestedPhoneColumn: "",
      confidence: 0, qualityScore: 0, totalContacts: 0, validContacts: 0,
      invalidContacts: 0, duplicateContacts: 0, previewRows: []
    };
  }

  const sampleRow = rows[0];
  const headers = Object.keys(sampleRow);

  // ── SIMPLE CSV / FAST PATH CHECK ────────────────────────────────
  const nameCols = [];
  const phoneCols = [];

  headers.forEach((h) => {
    const isPhoneLike = /phone|mobile|number|tel|whatsapp/i.test(h) || (/contact/i.test(h) && !/name/i.test(h));
    const isNameLike = /name|person|customer|student|leader|employee|parent/i.test(h) || (/contact/i.test(h) && /name/i.test(h));

    if (isPhoneLike) {
      // Validate that at least some rows have numbers or pattern matching
      let validCount = 0;
      let total = 0;
      rows.slice(0, 5).forEach(row => {
        const val = row[h];
        if (val) {
          total++;
          if (isValidPhonePattern(val)) validCount++;
        }
      });
      if (total === 0 || (validCount / total) > 0.5) {
        phoneCols.push(h);
      }
    } else if (isNameLike) {
      nameCols.push(h);
    }
  });

  const isSimple = nameCols.length === 1 && phoneCols.length === 1;
  let groups = [];

  if (isSimple) {
    console.log(`[Smart Discovery] Fast Path triggered. Single name column (${nameCols[0]}) and single phone column (${phoneCols[0]}) detected.`);
    groups = [{
      label: 'All Contacts',
      nameCol: nameCols[0],
      phoneCol: phoneCols[0],
      confidence: 100
    }];
  } else {
    // Priority 2: Advanced Discovery
    groups = detectGroupsHeuristic(headers, rows.slice(0, 5));

    // If poor confidence or no groups, try AI fallback
    if (groups.length === 0 || groups.some(g => g.confidence < 70)) {
      console.log("[Smart Discovery] Using AI Fallback...");
      const aiGroups = await detectGroupsAI(headers, rows.slice(0, 5));
      if (aiGroups && aiGroups.length > 0) {
        groups = aiGroups;
      }
    }
  }

  if (groups.length === 0) {
    throw new Error("Could not detect any phone number columns in this file.");
  }

  let totalContacts = 0, validContacts = 0, invalidContacts = 0, duplicateContacts = 0;
  let missingNames = 0, missingPhones = 0;

  // Extract contacts for each group
  const processedGroups = groups.map((g, idx) => {
    const contacts = [];
    const seenPhones = new Set();
    let gValid = 0, gInvalid = 0, gDup = 0;

    rows.forEach((row, rowIdx) => {
      const rawPhone = String(row[g.phoneCol] || '').trim();
      const rawName = g.nameCol ? String(row[g.nameCol] || '').trim() : '';
      
      if (!rawPhone) {
        missingPhones++;
        return;
      }
      if (!rawName && g.nameCol) {
        missingNames++;
      }

      totalContacts++;

      const normPhone = normalizePhone(rawPhone);
      if (seenPhones.has(normPhone)) {
        duplicateContacts++;
        gDup++;
        return;
      }
      seenPhones.add(normPhone);

      const isValid = isValidPhonePattern(rawPhone);
      if (isValid) {
        validContacts++;
        gValid++;
      } else {
        invalidContacts++;
        gInvalid++;
      }

      contacts.push({
        row: rowIdx + 2,
        name: rawName,
        phone: rawPhone,
        normalizedPhone: normPhone,
        isValid,
        error: isValid ? null : 'Invalid phone pattern'
      });
    });

    return {
      id: 'group_' + idx,
      label: g.label || g.phoneCol,
      nameCol: g.nameCol,
      phoneCol: g.phoneCol,
      confidence: g.confidence,
      stats: { total: contacts.length, valid: gValid, invalid: gInvalid, duplicates: gDup },
      contacts
    };
  });

  const bestGroup = groups.reduce((prev, current) => (prev.confidence > current.confidence) ? prev : current);
  const avgConfidence = groups.reduce((acc, g) => acc + g.confidence, 0) / groups.length;
  const qualityScore = validContacts > 0 ? Math.round((validContacts / (totalContacts - duplicateContacts)) * 10) : 0;

  return {
    detectedGroups: processedGroups,
    suggestedNameColumn: bestGroup.nameCol || "",
    suggestedPhoneColumn: bestGroup.phoneCol || "",
    confidence: avgConfidence,
    qualityScore: qualityScore,
    totalContacts,
    validContacts,
    invalidContacts,
    duplicateContacts,
    missingNames,
    missingPhones,
    previewRows: rows.slice(0, 5),
    isSimple
  };
}

module.exports = { processSpreadsheet };
