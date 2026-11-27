import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1]
WITH_TEST_DATA = len(sys.argv) > 2 and sys.argv[2] == "test"

FONT = "Arial"
FIRST, LAST = 11, 110          # data rows on month tabs
SPLIT_FIRST, SPLIT_LAST = 11, 35  # split option rows on Settings
SPLIT_LIST = f"Settings!$A${SPLIT_FIRST}:$A${SPLIT_LAST}"
SPLIT_TABLE = f"Settings!$A${SPLIT_FIRST}:$C${SPLIT_LAST}"
DEFAULT_SPLIT = "Settings!$B$3"

NAVY = PatternFill("solid", fgColor="1F3864")
GREEN = PatternFill("solid", fgColor="B7E1CD")
BLUE_T = PatternFill("solid", fgColor="CFE2F3")
ORANGE_T = PatternFill("solid", fgColor="FCE5CD")
HEAD = PatternFill("solid", fgColor="EFEFEF")
CALC = PatternFill("solid", fgColor="F3F3F3")
YELLOW = PatternFill("solid", fgColor="FFF2CC")
thin = Side(style="thin", color="D0D0D0")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
MONEY = '$#,##0.00;($#,##0.00);"-"'


def f(bold=False, size=10, color="000000", italic=False):
    return Font(name=FONT, bold=bold, size=size, color=color, italic=italic)


def put(ws, ref, value=None, **style):
    c = ws[ref]
    if value is not None:
        c.value = value
    c.font = style.get("font", f())
    for k in ("fill", "alignment", "border", "number_format"):
        if k in style:
            setattr(c, k, style[k])
    return c


def month_sheet(wb, title, heading, test_rows=None):
    ws = wb.create_sheet(title)
    ws.sheet_view.showGridLines = False
    widths = {"A": 12, "B": 30, "C": 12, "D": 13, "E": 13, "F": 3,
              "G": 12, "H": 30, "I": 12, "J": 13, "K": 13}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    put(ws, "A1", heading, font=f(bold=True, size=14))
    ws.merge_cells("A2:K2")
    put(ws, "A2",
        "Log what you paid in your own table. In Split, your share comes first: "
        "60/40 means you cover 60%. A blank Split uses the default on the Settings tab (50/50). "
        "Gray cells calculate on their own.",
        font=f(italic=True, color="666666"),
        alignment=Alignment(wrap_text=True, vertical="top"))
    ws.row_dimensions[2].height = 28

    # Settle-up block
    ws.merge_cells("A4:C4")
    put(ws, "A4", "Settle up", font=f(bold=True, color="FFFFFF"), fill=NAVY)
    ws.merge_cells("G4:I4")
    put(ws, "G4", "Spending this month", font=f(bold=True, color="FFFFFF"), fill=NAVY)

    rows = [
        (5, "Jonah owes Orlando", f"=SUM(E{FIRST}:E{LAST})", "Orlando paid", f"=SUM(C{FIRST}:C{LAST})"),
        (6, "Orlando owes Jonah", f"=SUM(K{FIRST}:K{LAST})", "Jonah paid", f"=SUM(I{FIRST}:I{LAST})"),
    ]
    for r, l1, v1, l2, v2 in rows:
        ws.merge_cells(f"A{r}:B{r}")
        put(ws, f"A{r}", l1, border=BOX)
        put(ws, f"B{r}", border=BOX)
        put(ws, f"C{r}", v1, number_format=MONEY, border=BOX)
        ws.merge_cells(f"G{r}:H{r}")
        put(ws, f"G{r}", l2, border=BOX)
        put(ws, f"H{r}", border=BOX)
        put(ws, f"I{r}", v2, number_format=MONEY, border=BOX)

    ws.merge_cells("A7:B7")
    put(ws, "A7", '=IF(C5>C6,"Jonah Venmos Orlando",IF(C6>C5,"Orlando Venmos Jonah","All square, nobody owes"))',
        font=f(bold=True, size=11), fill=GREEN, border=BOX)
    put(ws, "B7", fill=GREEN, border=BOX)
    put(ws, "C7", "=ABS(C5-C6)", font=f(bold=True, size=11), fill=GREEN, border=BOX, number_format=MONEY)
    ws.row_dimensions[7].height = 20
    ws.merge_cells("G7:H7")
    put(ws, "G7", "Total shared spending", font=f(bold=True), border=BOX)
    put(ws, "H7", border=BOX)
    put(ws, "I7", "=I5+I6", font=f(bold=True), border=BOX, number_format=MONEY)

    # Two expense tables
    tables = [
        ("A", "Paid by Orlando", BLUE_T, ["Date", "Item", "Amount", "Split\n(Orlando/Jonah)", "Jonah owes"]),
        ("G", "Paid by Jonah", ORANGE_T, ["Date", "Item", "Amount", "Split\n(Jonah/Orlando)", "Orlando owes"]),
    ]
    dv = DataValidation(type="list", formula1=SPLIT_LIST, allow_blank=True,
                        showErrorMessage=True, errorTitle="Pick a split",
                        error="Choose a split from the list. Add new options on the Settings tab.")
    ws.add_data_validation(dv)
    for start, label, fill, headers in tables:
        c0 = ord(start) - ord("A")
        cols = [chr(ord("A") + c0 + i) for i in range(5)]
        ws.merge_cells(f"{cols[0]}9:{cols[4]}9")
        put(ws, f"{cols[0]}9", label, font=f(bold=True, size=11), fill=fill)
        for col in cols[1:]:
            put(ws, f"{col}9", fill=fill)
        for col, h in zip(cols, headers):
            put(ws, f"{col}10", h, font=f(bold=True), fill=HEAD, border=BOX,
                alignment=Alignment(wrap_text=True, vertical="center",
                                    horizontal="left" if col in (cols[0], cols[1]) else "right"))
        date_c, item_c, amt_c, split_c, owe_c = cols
        for r in range(FIRST, LAST + 1):
            put(ws, f"{date_c}{r}", border=BOX, number_format="mmm d", alignment=Alignment(horizontal="left"))
            put(ws, f"{item_c}{r}", border=BOX)
            put(ws, f"{amt_c}{r}", border=BOX, number_format=MONEY)
            put(ws, f"{split_c}{r}", border=BOX, alignment=Alignment(horizontal="right"))
            put(ws, f"{owe_c}{r}",
                f'=IF({amt_c}{r}="","",ROUND({amt_c}{r}*VLOOKUP(IF({split_c}{r}="",{DEFAULT_SPLIT},{split_c}{r}),{SPLIT_TABLE},3,FALSE),2))',
                border=BOX, fill=CALC, number_format=MONEY)
        dv.add(f"{split_c}{FIRST}:{split_c}{LAST}")
    ws.row_dimensions[10].height = 30
    ws.freeze_panes = "A11"

    if test_rows:
        import datetime as dt
        for (col0, items) in test_rows:
            c0 = ord(col0) - ord("A")
            cols = [chr(ord("A") + c0 + i) for i in range(4)]
            for i, (d, item, amt, split) in enumerate(items):
                r = FIRST + i
                ws[f"{cols[0]}{r}"] = dt.date(2026, 11, d)
                ws[f"{cols[1]}{r}"] = item
                ws[f"{cols[2]}{r}"] = amt
                if split:
                    ws[f"{cols[3]}{r}"] = split
    return ws


def settings_sheet(wb):
    ws = wb.create_sheet("Settings")
    ws.sheet_view.showGridLines = False
    for col, w in {"A": 16, "B": 16, "C": 22, "D": 44}.items():
        ws.column_dimensions[col].width = w
    put(ws, "A1", "Settings", font=f(bold=True, size=14))

    put(ws, "A3", "Default split", font=f(bold=True), border=BOX)
    put(ws, "B3", "50/50", font=f(color="0000FF"), fill=YELLOW, border=BOX,
        alignment=Alignment(horizontal="right"))
    ws.merge_cells("C3:D3")
    put(ws, "C3", "Used when the Split cell on a month tab is left blank.",
        font=f(italic=True, color="666666"))
    dv = DataValidation(type="list", formula1=SPLIT_LIST, allow_blank=False, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add("B3")

    put(ws, "A5", "Starting a new month", font=f(bold=True))
    ws.merge_cells("A6:D6")
    put(ws, "A6",
        "Right-click the Template tab, choose Duplicate, rename the copy (for example, Jan 2027), "
        "and update the title in cell A1.",
        alignment=Alignment(wrap_text=True, vertical="top"))
    ws.row_dimensions[6].height = 28

    ws.merge_cells("A8:D8")
    put(ws, "A8", "Split options", font=f(bold=True, color="FFFFFF"), fill=NAVY)
    ws.merge_cells("A9:D9")
    put(ws, "A9",
        "The first number is the share of whoever paid. Example: Jonah pays $100 and picks 60/40, "
        "so Jonah covers $60 and Orlando owes him $40. To add an option, fill in the next empty row "
        "(blue cells are editable).",
        font=f(italic=True, color="666666"), alignment=Alignment(wrap_text=True, vertical="top"))
    ws.row_dimensions[9].height = 42
    for col, h in zip("ABCD", ["Split", "Payer's share", "Other person's share", "Note"]):
        put(ws, f"{col}10", h, font=f(bold=True), fill=HEAD, border=BOX,
            alignment=Alignment(horizontal="left" if col in "AD" else "right"))
    options = [("50/50", 0.5, "Even split"), ("60/40", 0.6, None), ("40/60", 0.4, None),
               ("70/30", 0.7, None), ("30/70", 0.3, None),
               ("0/100", 0.0, "Bought entirely for the other person")]
    for r in range(SPLIT_FIRST, SPLIT_LAST + 1):
        i = r - SPLIT_FIRST
        opt = options[i] if i < len(options) else (None, None, None)
        put(ws, f"A{r}", opt[0], font=f(color="0000FF"), border=BOX, number_format="@")
        put(ws, f"B{r}", opt[1], font=f(color="0000FF"), border=BOX, number_format="0%")
        put(ws, f"C{r}", f'=IF(B{r}="","",1-B{r})', border=BOX, fill=CALC, number_format="0%")
        put(ws, f"D{r}", opt[2], font=f(color="0000FF"), border=BOX)
    return ws


wb = Workbook()
wb.remove(wb.active)
test = None
if WITH_TEST_DATA:
    test = [("A", [(2, "Groceries", 100, "50/50"), (5, "Gas", 60, None), (9, "Dinner", 33.33, "60/40")]),
            ("G", [(3, "Utilities", 200, "60/40"), (12, "Concert tickets", 45, "0/100")])]
month_sheet(wb, "Nov 2026", "November 2026", test)
month_sheet(wb, "Dec 2026", "December 2026")
month_sheet(wb, "Template", "Month Year")
settings_sheet(wb)
wb.save(OUT)
print("saved", OUT)
