@echo off
cd /d "E:\Automation Scripts and Temp Codes\TT_Calendar"
python -u -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 > dev_backend.log 2> dev_backend.err
