"""Build documentation artifacts only; application source and configuration are untouched."""
import os
import re
import sys
from copy import deepcopy
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(os.environ["TEMP"]) / "ctip-report-libs"))
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image, KeepTogether, LongTable, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, TableStyle,
)

HERE = Path(__file__).resolve().parent
TEMPLATE = Path(r"C:\Users\stan\Downloads\_Sprint1_Report_CTIP(2) (1).docx")
STEMS = ["Sprint_2_Report_Group_10_No_Timeline", "Sprint_2_Technical_Documentation_Group_10"]


def blocks(text):
    lines = text.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            i += 1
            code = []
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            out.append(("code", "\n".join(code)))
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            out.append(("table", rows))
            continue
        elif line.startswith("#"):
            match = re.match(r"(#+)\s+(.*)", line)
            out.append(("heading", (len(match[1]), match[2])))
        elif line.startswith("!["):
            match = re.match(r"!\[(.*?)\]\((.*?)\)", line)
            out.append(("image", (match[1], match[2])))
        else:
            kind = "caption" if line.startswith("*") and line.endswith("*") else "p"
            parts = [line.strip("*") if kind == "caption" else line]
            while i + 1 < len(lines) and lines[i + 1].strip() and not lines[i + 1].startswith(("#", "|", "```", "![")):
                i += 1
                parts.append(lines[i].strip())
            out.append((kind, " ".join(parts)))
        i += 1
    return out


def widths(rows, total):
    n = len(rows[0])
    header = " ".join(rows[0]).lower()
    if n == 2:
        weights = [0.31, 0.69] if "student id" not in header else [0.72, 0.28]
    elif n == 3:
        weights = [0.23, 0.28, 0.49]
        if "jira" in header and "additional" in header:
            weights = [0.18, 0.64, 0.18]
        if "screenshot status" in header:
            weights = [0.32, 0.16, 0.52]
        if "latest status" in header:
            weights = [0.18, 0.10, 0.72]
        if "acceptance" in header or "observable" in header:
            weights = [0.24, 0.30, 0.46]
    elif n == 4:
        weights = [0.15, 0.45, 0.17, 0.23]
        if "module" in header:
            weights = [0.18, 0.13, 0.49, 0.20]
    else:
        weights = [1 / n] * n
    return [total * w for w in weights]


def set_repeat_header(row):
    prop = row._tr.get_or_add_trPr()
    prop.append(OxmlElement("w:tblHeader"))


def word_table(doc, rows, cover=False):
    table = doc.add_table(rows=1, cols=len(rows[0]))
    table.style = "Table Grid"
    table.autofit = False
    sizes = widths(rows, 6.27)
    for col, size in zip(table.columns, sizes):
        col.width = Inches(size)
    for ri, row in enumerate(rows):
        cells = table.rows[0].cells if ri == 0 else table.add_row().cells
        for cell, value, size in zip(cells, row, sizes):
            cell.width = Inches(size)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.line_spacing = 1.05
            run = p.add_run(value)
            run.font.size = Pt(10 if cover else 9)
            if ri == 0:
                run.bold = True
                shade = OxmlElement("w:shd")
                shade.set(qn("w:fill"), "E7EBEF")
                cell._tc.get_or_add_tcPr().append(shade)
        trpr = table.rows[ri]._tr.get_or_add_trPr()
        trpr.append(OxmlElement("w:cantSplit"))
    set_repeat_header(table.rows[0])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def word_doc(stem, items):
    doc = Document()
    template = Document(TEMPLATE)
    # Reuse the original styles without carrying its old images or report text.
    for styleid in ["Heading1", "Heading2", "Heading3"]:
        old = next(s for s in template.styles.element if s.get(qn("w:styleId")) == styleid)
        current = next(s for s in doc.styles.element if s.get(qn("w:styleId")) == styleid)
        current.getparent().replace(current, deepcopy(old))
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(11)
    normal.paragraph_format.line_spacing = 1.15
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.widow_control = True
    for name in ["Heading 1", "Heading 2", "Heading 3"]:
        doc.styles[name].font.name = "Times New Roman"
        doc.styles[name].font.bold = True
        doc.styles[name].font.color.rgb = None
        doc.styles[name].paragraph_format.keep_with_next = True
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.top_margin = sec.left_margin = sec.right_margin = Mm(25.4)
    sec.bottom_margin = Mm(22.93)
    sec.header_distance = sec.footer_distance = Mm(12.49)
    sec.different_first_page_header_footer = True
    head = sec.header.paragraphs[0]
    head.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = head.add_run("COS30049 · Group 10 · Sprint 2")
    run.font.size = Pt(9)
    foot = sec.footer.paragraphs[0]
    foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = foot.add_run("Page ")
    run.font.size = Pt(9)
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    foot._p.append(field)
    cover = True
    logo = HERE / "assets/sprint2_logo.jpg"
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(logo), width=Inches(4.0))
    for kind, value in items:
        if kind == "heading":
            level, title = value
            if cover:
                doc.add_page_break()
                cover = False
            elif level == 1:
                doc.add_page_break()
            doc.add_heading(title, level)
        elif kind == "table":
            word_table(doc, value, cover)
        elif kind == "image":
            from PIL import Image as PILImage
            alt, relative = value
            path = HERE / relative
            iw, ih = PILImage.open(path).size
            width = min(6.1, 5.6 * iw / ih)
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.keep_with_next = True
            shape = p.add_run().add_picture(str(path), width=Inches(width))
            shape._inline.docPr.set("descr", alt)
        elif kind == "code":
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(8)
            p.paragraph_format.line_spacing = 1
            r = p.add_run(value)
            r.font.name = "Consolas"
            r.font.size = Pt(8)
        else:
            p = doc.add_paragraph(value)
            if cover:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_after = Pt(9)
                for run in p.runs:
                    run.font.size = Pt(12)
                if value in ["Sprint 2 Report", "Sprint 2 Technical Documentation", "COS30049 COMPUTING TECHNOLOGY INNOVATION PROJECT"]:
                    p.runs[0].bold = True
            elif kind == "caption":
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                p.paragraph_format.space_after = Pt(9)
                for run in p.runs:
                    run.italic = True
                    run.font.size = Pt(9)
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.core_properties.title = "Sprint 2 Report" if "No_Timeline" in stem else "Sprint 2 Technical Documentation"
    doc.core_properties.author = "Group 10"
    doc.core_properties.subject = "Code-based progress review, 4 November 2026"
    path = HERE / (stem + ".docx")
    doc.save(path)
    print("WORD", path.name, "paragraphs", len(doc.paragraphs), "tables", len(doc.tables))


def pdf_doc(stem, items):
    fontdir = Path(r"C:\Windows\Fonts")
    for font, filename in [("CTIPTimes", "times.ttf"), ("CTIPTimes-Bold", "timesbd.ttf"),
                           ("CTIPTimes-Italic", "timesi.ttf"), ("CTIPTimes-BoldItalic", "timesbi.ttf")]:
        if font not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(font, str(fontdir / filename)))
    pdfmetrics.registerFontFamily("CTIPTimes", normal="CTIPTimes", bold="CTIPTimes-Bold",
                                 italic="CTIPTimes-Italic", boldItalic="CTIPTimes-BoldItalic")
    styles = {
        "p": ParagraphStyle("Body", fontName="CTIPTimes", fontSize=11, leading=12.65,
                            alignment=TA_JUSTIFY, spaceAfter=6, allowWidows=0, allowOrphans=0),
        "cover": ParagraphStyle("Cover", fontName="CTIPTimes", fontSize=12, leading=15,
                                alignment=TA_CENTER, spaceAfter=10),
        "caption": ParagraphStyle("Caption", fontName="CTIPTimes-Italic", fontSize=9, leading=11,
                                  spaceAfter=10),
        "cell": ParagraphStyle("Cell", fontName="CTIPTimes", fontSize=9, leading=10.5,
                               alignment=TA_LEFT, splitLongWords=True),
        "code": ParagraphStyle("Code", fontName="Courier", fontSize=7.3, leading=10,
                               spaceAfter=8, backColor=colors.HexColor("#F2F3F4"), borderPadding=5),
    }
    for level, size in [(1, 16), (2, 13), (3, 11.5)]:
        styles[f"h{level}"] = ParagraphStyle(f"Heading{level}", fontName="CTIPTimes-Bold", fontSize=size,
                                             leading=size * 1.16, spaceBefore=10, spaceAfter=6,
                                             keepWithNext=True)
    title = "Sprint 2 Report" if "No_Timeline" in stem else "Sprint 2 Technical Documentation"
    doc = SimpleDocTemplate(str(HERE / (stem + ".pdf")), pagesize=A4,
                            leftMargin=72, rightMargin=72, topMargin=72, bottomMargin=65,
                            title=title, author="Group 10", allowSplitting=True)
    story, cover = [], True
    story.append(Image(str(HERE / "assets/sprint2_logo.jpg"), width=288, height=288 * 279 / 549))
    story.append(Spacer(1, 12))
    consumed = set()
    for item_index, (kind, value) in enumerate(items):
        if item_index in consumed:
            continue
        if kind == "heading":
            level, text = value
            if cover or level == 1:
                story.append(PageBreak())
            cover = False
            story.append(Paragraph(escape(text), styles[f"h{level}"]))
        elif kind == "table":
            rows = [[Paragraph(("<b>" if ri == 0 else "") + escape(cell) + ("</b>" if ri == 0 else ""), styles["cell"])
                     for cell in row] for ri, row in enumerate(value)]
            table = LongTable(rows, colWidths=widths(value, doc.width), repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7EBEF")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#AAB3BA")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.extend([table, Spacer(1, 7)])
        elif kind == "image":
            from PIL import Image as PILImage
            path = HERE / value[1]
            iw, ih = PILImage.open(path).size
            w = min(doc.width, 360 * iw / ih)
            figure = [Image(str(path), width=w, height=w * ih / iw), Spacer(1, 5)]
            if item_index + 1 < len(items) and items[item_index + 1][0] == "caption":
                figure.append(Paragraph(escape(items[item_index + 1][1]), styles["caption"]))
                consumed.add(item_index + 1)
            story.append(KeepTogether(figure))
        elif kind == "code":
            story.append(Paragraph(escape(value).replace("\n", "<br/>"), styles["code"]))
        else:
            text = escape(value)
            if cover and value in ["Sprint 2 Report", "Sprint 2 Technical Documentation", "COS30049 COMPUTING TECHNOLOGY INNOVATION PROJECT"]:
                text = "<b>" + text + "</b>"
            story.append(Paragraph(text, styles["cover"] if cover else styles[kind]))

    def decorate(canvas, document):
        if document.page == 1:
            return
        canvas.saveState()
        canvas.setFont("CTIPTimes", 9)
        canvas.setFillColor(colors.HexColor("#58616A"))
        canvas.drawRightString(A4[0] - 72, A4[1] - 39, "COS30049 · Group 10 · Sprint 2")
        canvas.drawCentredString(A4[0] / 2, 35, f"Page {document.page}")
        canvas.restoreState()
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    print("PDF", stem + ".pdf")


if __name__ == "__main__":
    for stem in STEMS:
        content = blocks((HERE / (stem + ".md")).read_text(encoding="utf-8"))
        word_doc(stem, content)
        pdf_doc(stem, content)
