import asyncio, json, subprocess, time, serial
import board, adafruit_tcs34725, websockets
from adafruit_pn532.uart import PN532_UART

light = adafruit_tcs34725.TCS34725(board.I2C())
light.integration_time = 100
light.gain = 16
BRIGHT_ON, DARK_OFF, DARK_SECONDS = 300, 40, 5
OUTPUT = "HDMI-A-2"

def open_nfc(port="/dev/ttyAMA0"):
    # the PN532 emits a wake-up preamble that trips the library's parser
    uart = serial.Serial(port, baudrate=115200, timeout=1)
    uart.write(b"\x55\x55" + b"\x00" * 14)
    time.sleep(0.2)
    uart.reset_input_buffer()
    return PN532_UART(uart)

nfc = open_nfc()
nfc.SAM_configuration()
clients, screen_on = set(), None

async def send(msg):
    for ws in list(clients):
        try: await ws.send(json.dumps(msg))
        except Exception: clients.discard(ws)

async def handler(ws):
    clients.add(ws)
    await ws.send(json.dumps({"type": "wake" if screen_on else "sleep"}))
    try:
        async for raw in ws:
            if json.loads(raw).get("type") == "shutdown":
                subprocess.run(["sudo", "systemctl", "poweroff"])
    finally:
        clients.discard(ws)

async def set_screen(on):
    global screen_on
    if on == screen_on: return
    screen_on = on
    subprocess.run(["wlr-randr", "--output", OUTPUT, "--on" if on else "--off"])
    await send({"type": "wake" if on else "sleep"})

async def light_loop():
    dark_since = None
    while True:
        b = light.color_raw[3]
        if b > BRIGHT_ON:
            dark_since = None
            await set_screen(True)
        elif b < DARK_OFF:
            dark_since = dark_since or time.time()
            if time.time() - dark_since > DARK_SECONDS:
                await set_screen(False)
        await send({"type": "light", "kelvin": light.color_temperature,
                    "lux": light.lux, "brightness": b})
        await asyncio.sleep(0.25)

async def tag_loop():
    last = None
    while True:
        uid = await asyncio.to_thread(nfc.read_passive_target, timeout=0.3)
        tag = uid.hex() if uid else None
        if tag and tag != last:
            await set_screen(True)
            await send({"type": "tag", "uid": tag, "at": time.strftime("%H:%M:%S")})
        elif not tag and last:
            await send({"type": "tag-gone"})
        last = tag

async def main():
    await set_screen(True)
    async with websockets.serve(handler, "localhost", 8765):
        print("hardware service running")
        await asyncio.gather(light_loop(), tag_loop())

asyncio.run(main())
