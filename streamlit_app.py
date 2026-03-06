import streamlit as st
import streamlit.components.v1 as components

# ================= CONFIGURAÇÃO DA PÁGINA =================
st.set_page_config(
    page_title="Smart Play Insight",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ================= REMOVER INTERFACE STREAMLIT =================
st.markdown("""
<style>
#MainMenu {visibility: hidden;}
footer {visibility: hidden;}
header {visibility: hidden;}

.block-container {
    padding:0rem;
    margin:0rem;
}

[data-testid="stAppViewContainer"]{
    padding:0rem;
}

[data-testid="stVerticalBlock"]{
    gap:0rem;
}
</style>
""", unsafe_allow_html=True)

# ================= URL DO LOVABLE =================
lovable_url = "https://smart-play-insight.lovable.app"

# ================= IFRAME FULL SCREEN OTIMIZADO =================
components.html(
    f"""
    <html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <style>
    body {{
        margin:0;
        padding:0;
        overflow:hidden;
        background:#0e1117;
    }}

    .container {{
        position:fixed;
        top:0;
        left:0;
        width:100vw;
        height:100vh;
    }}

    iframe {{
        width:100%;
        height:100%;
        border:none;
        overflow:hidden;
    }}
    </style>
    </head>

    <body>

    <div class="container">
        <iframe src="{lovable_url}" allowfullscreen></iframe>
    </div>

    </body>
    </html>
    """,
    height=1000,
)
