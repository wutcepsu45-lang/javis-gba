"""Build a tiny homebrew GBA ROM for testing (animated colour stripes, A = speed up)."""
import sys
from keystone import Ks, KS_ARCH_ARM, KS_MODE_ARM

ASM = """
start:
    mov r0, #0x04000000
    mov r1, #0x400
    orr r1, r1, #3          @ mode 3 + BG2
    strh r1, [r0]
    mov r5, #0              @ animation counter
loop:
    mov r2, #0x04000000
    orr r2, r2, #6
wait_out:
    ldrh r3, [r2]
    cmp r3, #160
    bge wait_out
wait_in:
    ldrh r3, [r2]
    cmp r3, #160
    blt wait_in
    mov r0, #0x06000000
    mov r6, #0              @ y
row:
    mov r7, #0              @ x
col:
    add r1, r7, r5
    and r1, r1, #31         @ red from x + time
    add r3, r6, r5, lsr #1
    and r3, r3, #31
    orr r1, r1, r3, lsl #10 @ blue from y
    strh r1, [r0], #2
    add r7, r7, #1
    cmp r7, #240
    blt col
    add r6, r6, #1
    cmp r6, #160
    blt row
    mov r4, #0x04000000
    orr r4, r4, #0x130
    ldrh r4, [r4]
    tst r4, #1              @ A pressed -> bit clear
    addeq r5, r5, #4
    addne r5, r5, #1
    b loop
"""

ks = Ks(KS_ARCH_ARM, KS_MODE_ARM)
code, _ = ks.asm(ASM, 0x080000C0)
rom = bytearray(0xC0)
rom[0:4] = (0xEA00002E).to_bytes(4, "little")  # b 0xC0
rom[0xA0:0xAC] = b"JAVISTEST\0\0\0"
rom[0xAC:0xB0] = b"JVTS"
rom[0xB0:0xB2] = b"00"
rom[0xB2] = 0x96
chk = 0
for b in rom[0xA0:0xBD]:
    chk = (chk - b) & 0xFF
rom[0xBD] = (chk - 0x19) & 0xFF
rom += bytes(code)
rom += bytes((-len(rom)) % 1024)
open(sys.argv[1], "wb").write(rom)
print("wrote", len(rom), "bytes")
