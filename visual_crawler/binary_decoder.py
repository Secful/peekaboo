"""Binary WebSocket payload decoder."""

from typing import Optional


def extract_ascii_strings(hex_data: str, min_length: int = 4) -> list[str]:
    """Extract ASCII strings from hex data."""
    try:
        # Convert hex to bytes
        data = bytes.fromhex(hex_data)
        # Find printable ASCII sequences
        strings = []
        current = []
        for byte in data:
            if 32 <= byte <= 126:  # Printable ASCII
                current.append(chr(byte))
            else:
                if len(current) >= min_length:
                    strings.append(''.join(current))
                current = []
        if len(current) >= min_length:
            strings.append(''.join(current))
        return strings
    except Exception:
        return []


def decode_as_protobuf(hex_data: str) -> Optional[dict]:
    """Attempt protobuf-like structure extraction (without schema)."""
    try:
        data = bytes.fromhex(hex_data)
        result = {
            "format": "protobuf (best guess)",
            "fields": [],
            "note": "Decoded without schema - field names unknown"
        }

        i = 0
        while i < len(data):
            if i + 1 >= len(data):
                break
            # Try to parse field tag (varint)
            tag = data[i]
            wire_type = tag & 0x07
            field_num = tag >> 3

            if field_num == 0:
                break

            i += 1

            # Extract value based on wire type
            value_str = None
            if wire_type == 0:  # Varint
                value = 0
                shift = 0
                while i < len(data) and data[i] & 0x80:
                    value |= (data[i] & 0x7F) << shift
                    shift += 7
                    i += 1
                if i < len(data):
                    value |= data[i] << shift
                    i += 1
                value_str = str(value)
            elif wire_type == 2:  # Length-delimited
                if i < len(data):
                    length = data[i]
                    i += 1
                    if i + length <= len(data):
                        chunk = data[i:i+length]
                        # Try decode as string
                        try:
                            value_str = chunk.decode('utf-8')
                        except:
                            value_str = chunk.hex()
                        i += length

            if value_str:
                result["fields"].append({
                    "field": field_num,
                    "type": ["varint", "64bit", "length-delimited", "start-group", "end-group", "32bit"][wire_type] if wire_type < 6 else "unknown",
                    "value": value_str
                })

        return result if result["fields"] else None
    except Exception:
        return None


def decode_binary_payload(hex_data: str) -> dict:
    """Decode binary WebSocket payload using multiple strategies."""
    result = {
        "original_hex": hex_data[:200] + ("..." if len(hex_data) > 200 else ""),
        "size": len(hex_data) // 2,
        "decodings": []
    }

    # ASCII strings
    strings = extract_ascii_strings(hex_data)
    if strings:
        result["decodings"].append({
            "format": "ASCII Strings",
            "content": strings,
            "confidence": "high" if len(strings) > 2 else "medium"
        })

    # Protobuf attempt
    proto = decode_as_protobuf(hex_data)
    if proto:
        result["decodings"].append({
            "format": proto["format"],
            "content": proto,
            "confidence": "medium"
        })

    # Raw interpretation
    try:
        data = bytes.fromhex(hex_data)
        result["decodings"].append({
            "format": "Raw Bytes",
            "content": {
                "hex": hex_data[:100] + ("..." if len(hex_data) > 100 else ""),
                "length": len(data),
                "first_bytes": " ".join(f"{b:02x}" for b in data[:20])
            },
            "confidence": "low"
        })
    except Exception:
        pass

    return result
