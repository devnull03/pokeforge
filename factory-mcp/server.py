from fastmcp import FastMCP
from starlette.responses import JSONResponse

mcp = FastMCP("factory-mcp")


@mcp.custom_route(path="/health", methods=["GET"])
async def health(request):
    """Verification endpoint: GET /health returns server status."""
    return JSONResponse({"status": "ok", "server": "factory-mcp"})


@mcp.tool()
def create_mcp(url: str, automation_goal: str) -> dict:
    return {
        "status": "received",
        "url": url,
        "goal": automation_goal,
        "mcp_endpoint": f"https://generated.fake/{url.replace('https://','').replace('/','-')}"
    }


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8000)
