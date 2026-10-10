"""A short, fictional three-page report used for the README demo videos (OCR, mind map, chat)."""
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

styles = getSampleStyleSheet()
body, h1, h2 = styles["BodyText"], styles["Title"], styles["Heading2"]
body.leading = 15


def p(text):
    return Paragraph(text, body)


def table(rows, widths):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9aa4ad")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6ecef")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


story = [
    Paragraph("Harbor Point Wind Farm", h1),
    Paragraph("Feasibility brief · Prepared for the municipal energy board", styles["Italic"]),
    Spacer(1, 6 * mm),
    Paragraph("1. Summary", h2),
    p("Harbor Point is a 48 MW offshore wind project proposed four kilometres off the northern breakwater. "
      "Twelve turbines of 4 MW each would supply roughly 160 GWh a year, enough for about 42,000 homes. "
      "This brief summarises the wind resource, the grid connection, the expected costs and the open risks, "
      "and recommends moving to a full environmental assessment."),
    p("The site combines strong, steady winds with shallow water and an existing substation at the port. "
      "The main uncertainties are seabed conditions on the eastern edge and the timing of the shipping-lane review."),
    Paragraph("2. Wind resource", h2),
    p("A floating lidar buoy measured winds at hub height for fourteen months. Mean speeds peak in winter and "
      "remain usable through summer, which keeps output steadier than at the two inland sites compared below."),
    table([
        ["Site", "Mean wind (m/s)", "Capacity factor", "Annual output (GWh)"],
        ["Harbor Point", "8.9", "38%", "160"],
        ["Ridge Line", "7.4", "29%", "61"],
        ["Old Quarry", "6.8", "25%", "44"],
    ], [42 * mm, 36 * mm, 34 * mm, 42 * mm]),
    PageBreak(),
    Paragraph("3. Grid connection", h2),
    p("The port substation has 60 MW of spare capacity after its 2025 upgrade. A single 33 kV export cable "
      "would land at the old ferry slipway and run 1.8 km underground to the substation, avoiding new overhead lines."),
    Paragraph("4. Costs and schedule", h2),
    table([
        ["Item", "Cost (EUR million)", "Share"],
        ["Turbines and towers", "62.0", "52%"],
        ["Foundations", "24.5", "21%"],
        ["Export cable and substation works", "14.0", "12%"],
        ["Installation vessels", "11.5", "10%"],
        ["Development and contingency", "6.0", "5%"],
        ["Total", "118.0", "100%"],
    ], [70 * mm, 40 * mm, 24 * mm]),
    Spacer(1, 4 * mm),
    p("Construction would take two summer seasons, with first power in the second autumn after consent."),
    Paragraph("5. Risks", h2),
    ListFlowable([ListItem(p(item)) for item in [
        "Seabed surveys on the eastern edge may require deeper foundations for three turbines.",
        "The shipping-lane review could move two turbine positions by up to 400 metres.",
        "Turbine prices are quoted until March; later orders carry an estimated 6% increase.",
    ]], bulletType="bullet"),
    Paragraph("6. Recommendation", h2),
    p("Proceed to a full environmental impact assessment and a geotechnical survey of the eastern edge, "
      "with a decision on turbine procurement before the March price deadline."),
]

SimpleDocTemplate(sys.argv[1], pagesize=A4, title="Harbor Point Wind Farm — Feasibility brief",
                  leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm).build(story)
