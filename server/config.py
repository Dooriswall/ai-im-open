import os
from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv()

class Settings:
    APP_NAME: str = "AI IM Open Server"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # OpenClaw API 配置（示例）
    OPENCLAW_API_URL: str = os.getenv("OPENCLAW_API_URL", "https://api.openclaw.com/v1")
    OPENCLAW_API_KEY: str = os.getenv("OPENCLAW_API_KEY", "")

settings = Settings()
