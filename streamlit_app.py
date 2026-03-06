import streamlit as st
import streamlit.components.v1 as components

# ================= CONFIGURAÇÃO DA PÁGINA =================
st.set_page_config(
    page_title="Smart Play Insight",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ================= OCULTAR INTERFACE STREAMLIT =================
st.markdown("""
<style>

/* esconder menu */
#MainMenu {visibility: hidden;}

/* esconder header */
header {visibility: hidden;}

/* esconder footer */
footer {visibility: hidden;}

/* esconder botão manage app */
[data-testid="manage-app-button"]{
display:none !important;
}

/* esconder toolbar */
[data-testid="stToolbar"]{
display:none !important;
}

/* esconder decoração streamlit */
[data-testid="stDecoration"]{
display:none !important;
}

/* remover espaçamentos */
.block-container{
padding-top:0rem;
padding-bottom:0rem;
padding-left:0rem;
padding-right:0rem;
}

</style>
""", unsafe_allow_html=True)

# ================= URL DO APP =================
lovable_url = "https://smart-play-insight.lovable.app"

# ================= APP EM TELA CHEIA =================
components.html(
f"""
<style>
html, body {{
margin:0;
padding:0;
overflow:hidden;
background:#0e1117;
}}

iframe {{
position:fixed;
top:0;
left:0;
width:100vw;
height:100vh;
border:none;
}}
</style>

<iframe src="{lovable_url}"></iframe>
""",
height=1000
)
