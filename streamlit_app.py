import streamlit as st

# ================= CONFIGURAÇÃO DA PÁGINA =================
st.set_page_config(
    page_title="Smart Play Insight",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ================= MANIFEST PWA =================
st.markdown("""
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#ff7a00">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
""", unsafe_allow_html=True)

# ================= OCULTAR INTERFACE STREAMLIT =================
st.markdown("""
<style>
#MainMenu {visibility:hidden;}
footer {visibility:hidden;}
header {visibility:hidden;}

.block-container{
padding:0;
margin:0;
}
</style>
""", unsafe_allow_html=True)

# ================= URL DO APP =================
lovable_url = "https://smart-play-insight.lovable.app"

# ================= REDIRECIONAMENTO =================
st.markdown(
    f"""
    <meta http-equiv="refresh" content="0; url={lovable_url}">
    """,
    unsafe_allow_html=True
)

st.write("Abrindo Smart Play Insight...")
