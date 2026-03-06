import streamlit as st

# 1. Configuração de página para ocupar 100% da largura
st.set_page_config(page_title="Smart Play Insight", layout="wide")

# 2. CSS Avançado para travar o movimento e ajustar o tamanho
st.markdown("""
    <style>
        /* Remove barras de navegação e espaços brancos */
        header, footer, #MainMenu {visibility: hidden;}
        .stApp {bottom: 0px; top: 0px;}
        .block-container {padding: 0px; margin: 0px; max-width: 100%; height: 100vh;}
        
        /* Força o iframe a ocupar a tela inteira sem transbordar */
        iframe {
            width: 100vw;
            height: 100vh;
            border: none;
            position: fixed;
            top: 0;
            left: 0;
        }
        
        /* Desativa o scroll da página externa */
        html, body {
            overflow: hidden;
            height: 100%;
        }
    </style>
    """, unsafe_allow_html=True)

# 3. URL do seu projeto Lovable
lovable_url = "https://smart-play-insight.lovable.app" 

# 4. Exibição do componente
st.components.v1.iframe(lovable_url)
