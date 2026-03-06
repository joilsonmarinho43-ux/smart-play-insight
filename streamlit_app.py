import streamlit as st
import streamlit.components.v1 as components

# ================= CONFIGURAÇÃO =================
st.set_page_config(
    page_title="Smart Play Insight",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ================= REMOVER UI STREAMLIT =================
st.markdown("""
<style>
#MainMenu {visibility: hidden;}
footer {visibility: hidden;}
header {visibility: hidden;}

.block-container{
    padding:0;
    margin:0;
}
</style>
""", unsafe_allow_html=True)

lovable_url = "https://smart-play-insight.lovable.app"

# ================= IFRAME RESPONSIVO =================
components.html(
    f"""
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <style>
    body {{
        margin:0;
        padding:0;
        background:#0e1117;
        display:flex;
        justify-content:center;
        align-items:center;
        height:100vh;
    }}

    .wrapper {{
        width:100%;
        max-width:430px; /* largura ideal mobile */
        height:100vh;
    }}

    iframe {{
        width:100%;
        height:100%;
        border:none;
    }}
    </style>

    <div class="wrapper">
        <iframe src="{lovable_url}"></iframe>
    </div>
    """,
    height=1000,
)
