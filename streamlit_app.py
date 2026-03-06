import streamlit as st
import streamlit.components.v1 as components

# 1. Configuração de página para esconder o menu e usar a tela toda
st.set_page_config(page_title="Smart Play Insight", layout="wide", initial_sidebar_state="collapsed")

# 2. CSS para remover espaços brancos e travar o movimento
st.markdown("""
    <style>
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;}
        .block-container {padding: 0px; margin: 0px; max-width: 100%;}
        iframe {border: none; overflow: hidden;}
    </style>
    """, unsafe_allow_html=True)

# 3. URL do seu projeto (verifique se este link abre seu app do Lovable)
lovable_url = "https://smart-play-insight.lovable.app" 

# 4. Exibir em tela cheia (vh = view height, 100% da altura da tela)
components.iframe(lovable_url, height=900, scrolling=False)
