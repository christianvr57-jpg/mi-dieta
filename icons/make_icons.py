# Genera los iconos PNG sin dependencias externas.
import zlib, struct, math

def png(path, size):
    S = size
    rows = []
    for y in range(S):
        row = bytearray([0])
        for x in range(S):
            u, v = (x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5
            d = math.hypot(u, v)
            t = (u + v + 1) / 2  # degradado diagonal
            r = int(34 + (18 - 34) * t); g = int(160 + (110 - 160) * t); b = int(100 + (70 - 100) * t)
            a = (r, g, b)
            # plato: anillo blanco + disco interior
            ring = abs(d - 0.30) < 0.045
            inner = d < 0.215
            if ring: a = (255, 255, 255)
            elif inner: a = (236, 248, 241)
            # cubiertos simplificados: tenedor (izq.) y cuchillo (der.)
            if inner:
                if -0.12 < u < -0.09 and -0.14 < v < 0.14: a = (27, 122, 75)
                if -0.16 < u < -0.05 and -0.14 < v < -0.02 and (int((u + 0.16) * S / 0.035) % 2 == 0): a = (27, 122, 75)
                if 0.07 < u < 0.10 and -0.14 < v < 0.14: a = (27, 122, 75)
                if 0.08 < u < 0.14 and -0.14 < v < 0.0 and u < 0.115 + (0.005 if v < -0.07 else 0): a = (27, 122, 75)
            row += bytes(a)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 2, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

png('icon-512.png', 512)
png('icon-192.png', 192)
png('apple-touch-icon.png', 180)
