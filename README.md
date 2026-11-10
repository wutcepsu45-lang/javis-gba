# Javis GBA

แอป Android เล่นเกม Game Boy Advance — ใช้ core **mGBA** (ผ่าน EmulatorJS) ห่อด้วย **Capacitor**

## ฟีเจอร์
- คลังเกม: เพิ่มไฟล์ `.gba` / `.zip` จากเครื่อง เก็บไว้ในแอป เรียงตามที่เล่นล่าสุด เปลี่ยนชื่อ/ลบได้
- จอยสัมผัสบนจอ (D-pad, A, B, L, R, Start, Select) + เร่งความเร็ว (Fast) / Slow
- เซฟในเกมบันทึกอัตโนมัติ, Save/Load State, โกง (cheat), shader อยู่ในเมนู ☰ ระหว่างเล่น
- รองรับจอยบลูทูธ, เต็มจอ, ปุ่ม Back ของ Android กลับไปหน้าคลังเกม

## build APK (ไม่ต้องมีคอม — ใช้ GitHub)
1. สร้าง repo ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งโฟลเดอร์นี้ (ยกเว้น `node_modules/`, `www/`)
2. GitHub จะ build ให้อัตโนมัติ (แท็บ **Actions** → *Build APK*, ประมาณ 5–8 นาที)
3. เปิดหน้า **Releases → latest** บนมือถือ → ดาวน์โหลด `JavisGBA.apk` → ติดตั้ง (อนุญาต "ติดตั้งจากแหล่งที่ไม่รู้จัก")

## build บนคอม (Android Studio)
```bash
npm install
npm run sync        # สร้าง www/ แล้วคัดลอกเข้าโปรเจกต์ Android
npm run open        # เปิด Android Studio → Run
```
ต้องมี Node 22+, JDK 21, Android SDK 36

## โครงสร้าง
| ไฟล์ | หน้าที่ |
|---|---|
| `src/index.html` | ตัวแอปทั้งหมด: คลังเกม (IndexedDB) + หน้าเล่น |
| `build.sh` | รวม `src/` + EmulatorJS + core mGBA เป็น `www/` |
| `android/` | โปรเจกต์ Android (Capacitor) — `MainActivity` ตั้งค่าเต็มจอ |
| `.github/workflows/build-apk.yml` | build APK อัตโนมัติ |
| `tools/make_test_rom.py` | สร้าง ROM homebrew สำหรับทดสอบ |

## License
EmulatorJS เป็น GPL-3.0 และ mGBA เป็น MPL-2.0 — ถ้าแจกจ่ายแอปต้องเปิดซอร์สด้วยเงื่อนไข GPL-3.0
ใช้กับไฟล์เกมที่ dump จากตลับของตัวเองหรือเกม homebrew เท่านั้น
