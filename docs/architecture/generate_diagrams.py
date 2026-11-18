"""Generate editable SVG and presentation-ready PNG architecture diagrams."""
from pathlib import Path
from html import escape
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
COLORS = {'iot': '#0f766e', 'ai': '#6d28d9', 'api': '#2563eb', 'store': '#b45309', 'ui': '#334155'}
FONT = Path('C:/Windows/Fonts')

class Diagram:
    def __init__(self, title, subtitle, height=1100):
        self.w, self.h = 1600, height
        self.img = Image.new('RGB', (self.w, self.h), '#f8fafc')
        self.d = ImageDraw.Draw(self.img)
        self.svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="{height}" viewBox="0 0 1600 {height}">', '<rect width="100%" height="100%" fill="#f8fafc"/>', '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#64748b"/></marker></defs>']
        self.text(55, 40, title, 36, '#0f172a', True)
        self.text(55, 95, subtitle, 20, '#475569')

    def text(self, x, y, value, size=20, color='#334155', bold=False):
        font = ImageFont.truetype(str(FONT / ('arialbd.ttf' if bold else 'arial.ttf')), size)
        self.d.text((x, y), value, font=font, fill=color)
        self.svg.append(f'<text x="{x}" y="{y+size}" font-family="Arial, sans-serif" font-size="{size}" fill="{color}" font-weight="{700 if bold else 400}">{escape(value)}</text>')

    def box(self, x, y, title, lines, kind='api', w=300, h=145):
        color = COLORS[kind]
        self.d.rounded_rectangle((x, y, x+w, y+h), radius=14, fill='white', outline=color, width=2)
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="white" stroke="{color}" stroke-width="2"/>')
        self.text(x+20, y+17, title, 23, color, True)
        for i, line in enumerate(lines):
            self.text(x+20, y+58+i*26, line, 18)

    def arrow(self, points, label=None, lx=None, ly=None):
        self.d.line(points, fill='#64748b', width=3)
        x,y = points[-1]; px,py = points[-2]
        if x > px: tri=[(x,y),(x-10,y-5),(x-10,y+5)]
        elif x < px: tri=[(x,y),(x+10,y-5),(x+10,y+5)]
        elif y > py: tri=[(x,y),(x-5,y-10),(x+5,y-10)]
        else: tri=[(x,y),(x-5,y+10),(x+5,y+10)]
        self.d.polygon(tri, fill='#64748b')
        pts=' '.join(f'{x},{y}' for x,y in points)
        self.svg.append(f'<polyline points="{pts}" fill="none" stroke="#64748b" stroke-width="3" marker-end="url(#arrow)"/>')
        if label: self.text(lx,ly,label,17,'#475569')

    def save(self, name, notes):
        for i,line in enumerate(notes): self.text(55,self.h-95+i*27,line,18,'#475569')
        (OUT/f'{name}.svg').write_text('\n'.join(self.svg+['</svg>']), encoding='utf-8')
        self.img.save(OUT/f'{name}.png')


def combined():
    g=Diagram('AI + IoT | Combined System Architecture', 'Plant protection monitoring · ESP32 sensors + YOLO camera analysis · source-based design')
    g.text(55,165,'01  SENSOR COLLECTION AND BACKEND',20,COLORS['iot'],True)
    g.box(55,215,'Sensors + ESP32',['DHT11, soil and rain probes','MPU6050 movement detection','Local LED + serial dashboard'],'iot')
    g.box(445,215,'Laptop IoT gateway',['USB serial bridge OR','Wi-Fi HTTPS receiver :8443','SQLite outbox + upload retry'],'iot')
    g.box(835,215,'Plant API · Node.js',['Device authentication','Readings + threshold alerts','Fresh movement lookup'],'api')
    g.box(1225,215,'Supabase PostgreSQL',['Sensor readings / devices','Threat alerts + responses','Camera event metadata'],'store')
    for x in (355,745,1135): g.arrow([(x,285),(x+90,285)])
    g.text(55,435,'02  CAMERA ANALYSIS AND SENSOR FUSION',20,COLORS['ai'],True)
    g.box(55,490,'Camera input',['OpenCV video capture','Operator selects plant region','Mapped to database plant ID'],'ai')
    g.box(445,490,'YOLO models',['YOLOv8: humans / animals','YOLO-World: plant boxes','YOLO pose: wrist keypoints'],'ai')
    g.box(835,490,'Sensor fusion gate',['Wrist proximity for 2 seconds','AND fresh MPU6050 movement','Sensor assigned to same plant'],'ai')
    g.box(1225,490,'Camera outputs',['Possible-handling alert + sound','Annotated live feed :8001','Record clip + 5-second tail'],'ai')
    for x in (355,745,1135): g.arrow([(x,560),(x+90,560)])
    g.arrow([(985,360),(985,490)],'Movement state',1000,400)
    g.arrow([(1375,490),(1375,410),(1120,410),(1120,360)],'Event metadata via API',1140,377)
    g.text(55,745,'03  STORAGE AND OFFICER REVIEW',20,COLORS['ui'],True)
    g.box(835,805,'Local recording storage',['H.264 MP4 + JSON outbox','Shared camera / backend folder','Video bytes stay on local disk'],'store')
    g.box(1225,805,'Vue web dashboard',['Live camera + sensor readings','Threat alerts and clip playback','Officer review and response'],'ui')
    g.arrow([(1375,635),(1375,805)],'Live feed',1390,715)
    g.arrow([(1245,635),(1245,710),(985,710),(985,805)],'Saved clips',1000,720)
    g.arrow([(1135,875),(1225,875)])
    g.arrow([(1525,285),(1560,285),(1560,875),(1525,875)])
    g.text(65,830,'All dashboard data and clip access',21,'#475569')
    g.text(65,865,'use the application permission checks.',21,'#475569')
    g.save('combined-ai-iot', ['Arrows show data flow; database reads and video playback are mediated by the Plant API.', 'Scope: camera AI and sensor IoT. Hardware deployment and end-to-end operation are not verified by this diagram.'])


def ai():
    g=Diagram('AI | Camera Monitoring Architecture','YOLO detection, wrist proximity and sensor-confirmed possible-handling alerts',1160)
    g.box(55,210,'Video source',['Connected camera','OpenCV frame capture','Local Python camera process'],'ai')
    g.box(445,210,'YOLO inference',['YOLOv8n: humans / animals','YOLOv8s-World: plants','YOLOv8n-pose: wrists'],'ai')
    g.box(835,210,'Selected plant region',['Manual selection: P / drag','Fixed monitored image region','Linked database plant ID'],'ai')
    g.box(1225,210,'Contact timer',['Confident wrist near region','Inside / within 24 pixels','Sustained for 2 seconds'],'ai')
    for x in (355,745,1135): g.arrow([(x,280),(x+90,280)])
    g.box(55,515,'IoT movement source',['Plant API movement endpoint','Authenticated Sensor device','Same registered plant'],'iot')
    g.box(445,515,'Freshness checks',['MPU6050 health required','Reading age at most 5 sec','Stale / absent data cannot pass'],'iot')
    g.box(835,515,'Combined alert rule',['Timed wrist proximity','AND fresh movement = 1','Apply existing alert cooldown'],'ai')
    g.box(1225,515,'Possible handling',['On-screen alert + sound','Start / continue recording','End 5 sec after contact ends'],'ai')
    for x in (355,745,1135): g.arrow([(x,585),(x+90,585)])
    g.arrow([(1375,355),(1375,425),(985,425),(985,515)])
    g.box(445,845,'Live camera service',['Annotated frames + live events','Local HTTP service :8001','Events held in memory'],'ai')
    g.box(835,845,'Clip publisher',['H.264 MP4 + local JSON retry','Camera key authenticates event','Metadata sent to Plant API'],'store')
    g.box(1225,845,'Officer dashboard',['Live feed via camera proxy','Saved events via Plant API','Protected video playback'],'ui')
    g.arrow([(1295,660),(1295,750),(985,750),(985,845)])
    g.arrow([(595,355),(595,425),(395,425),(395,780),(595,780),(595,845)])
    g.arrow([(745,917),(790,917),(790,1020),(1375,1020),(1375,990)])
    g.arrow([(1135,917),(1225,917)])
    g.save('ai-camera-architecture',['Camera models run on the host computer. Human presence alone does not trigger the combined handling alert.', 'Possible handling is an estimate requiring officer review. Persisted events use PostgreSQL; completed videos remain local.'])


def iot():
    g=Diagram('IoT | ESP32 Sensor Architecture','Based on the current PlatformIO ESP32 firmware and the repository gateway / backend',1260)
    g.box(55,205,'Environmental sensors',['DHT11: temperature / humidity','Soil probe: raw ADC','Rain probe: raw ADC'],'iot',h=160)
    g.box(55,425,'MPU6050',['Accelerometer + gyroscope','I2C: SDA21 / SCL22','Movement + sensor health'],'iot',h=160)
    g.box(445,310,'ESP32 · Arduino',['Sample and check sensors','Detect movement locally','Timestamp + format readings'],'iot',h=160)
    g.arrow([(355,285),(400,285),(400,355),(445,355)])
    g.arrow([(355,505),(400,505),(400,425),(445,425)])
    g.box(835,205,'USB path',['Serial at 115200 baud','Python serial_bridge.py','Parses sensor dashboard'],'iot',h=160)
    g.box(835,425,'Wi-Fi path · optional',['HTTPS POST /readings :8443','CA validation + ingress token','Python wifi_receiver.py'],'iot',h=160)
    g.arrow([(745,355),(790,355),(790,285),(835,285)])
    g.arrow([(745,425),(790,425),(790,505),(835,505)])
    g.box(1225,310,'Durable host outbox',['Private SQLite queue','Preserve capture timestamp','Retry pending uploads'],'store',h=160)
    g.arrow([(1135,285),(1180,285),(1180,355),(1225,355)])
    g.arrow([(1135,505),(1180,505),(1180,425),(1225,425)])
    g.box(445,740,'AI camera consumer',['Polls movement through API','Fresh / healthy MPU6050 data','Same plant assignment required'],'ai')
    g.box(835,740,'Node.js Plant API',['POST /api/device/readings','Authenticate registered device','Store data + evaluate thresholds'],'api')
    g.box(1225,740,'Supabase PostgreSQL',['Readings and device mapping','Thresholds and alert history','Officer response records'],'store')
    g.arrow([(1375,470),(1375,655),(985,655),(985,740)],'Authenticated upload',1030,615)
    g.arrow([(1135,812),(1225,812)])
    g.arrow([(835,812),(745,812)])
    g.box(835,970,'Web IoT monitoring',['Sensor trends + threat alerts','Admin: devices / thresholds','Officer: review / respond'],'ui',w=690,h=145)
    g.arrow([(985,885),(985,970)])
    g.text(55,690,'FIRMWARE CONNECTIONS',20,COLORS['iot'],True)
    g.text(55,735,'DHT11 GPIO4 | Soil GPIO35',20)
    g.text(55,770,'Rain GPIO34 | LED GPIO5',20)
    g.text(55,805,'MPU6050 uses I2C',20)
    g.text(55,950,'Local movement also drives the LED.',20)
    g.text(55,985,'Select USB or Wi-Fi as the upload path.',20)
    g.save('iot-sensor-architecture',['Wi-Fi uploads require configuration; the ESP32 does not persist unsent packets while disconnected.', 'Loopback API HTTP is supported locally; remote backend connections require HTTPS. Physical sensor calibration remains necessary.'])


if __name__ == '__main__':
    combined(); ai(); iot()
    print('Generated three SVG diagrams and three PNG diagrams in', OUT)
