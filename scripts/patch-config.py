import pathlib

p = pathlib.Path('/home/user001/.hermes/config.yaml')
if p.exists():
    text = p.read_text()
    if 'auxiliary:' not in text:
        text += """

auxiliary:
  vision:
    provider: "main"
    model: "kiro"
  web_extract:
    provider: "main"
    model: "kiro"
  session_search:
    provider: "main"
    model: "kiro"
  compression:
    provider: "main"
    model: "kiro"
"""
        p.write_text(text)
        print("Successfully patched ~/.hermes/config.yaml with auxiliary section")
    else:
        print("~/.hermes/config.yaml already has auxiliary section")
else:
    print("config.yaml not found!")
