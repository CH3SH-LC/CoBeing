import comtypes.client
import os

pptx_path = os.path.abspath(r"D:\agent-codes\roadshow\玄武区创新大赛\PPT\模数杯路演.pptx")
pdf_path = os.path.abspath(r"D:\agent-codes\roadshow\玄武区创新大赛\PPT\模数杯路演.pdf")

print(f"Converting: {pptx_path}")
print(f"To: {pdf_path}")

powerpoint = comtypes.client.CreateObject("PowerPoint.Application")
powerpoint.Visible = 1

try:
    deck = powerpoint.Presentations.Open(pptx_path, WithWindow=False)
    # 32 = ppSaveAsPDF
    deck.SaveAs(pdf_path, 32)
    deck.Close()
    print("PDF saved successfully!")
except Exception as e:
    print(f"Error: {e}")
finally:
    powerpoint.Quit()
