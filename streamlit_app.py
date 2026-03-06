import streamlit as st

# 1. Configuração para ocupar a largura total
st.set_page_config(page_title="Smart Play Insight", layout="wide")

# 2. CSS para permitir rolagem vertical e esconder barras desnecessárias
st.markdown("""
    <style>
        /* Esconde elementos do Streamlit que poluem a tela */
        header, footer, #MainMenu {visibility: hidden;}
        
        /* Ajusta o container principal para não ter margens */
        .block-container {padding: 0px; margin: 0px; max-width: 100%;}
        
        /* O segredo: height 100vh fixa na tela, scrolling='yes' permite rodar os jogos */
        iframe {
            width: 100%;
            height: 100vh;
            border: none;
        }

        /* Garante que o corpo da página não crie uma segunda barra de rolagem */
        html, body {
            overflow: hidden;
        }
    </style>
    """, unsafe_allow_html=True)

# 3. Sua URL do Lovable
lovable_url = "https://smart-play-insight.lovable.app" 

# 4. Componente com rolagem ativada
st.components.v1.iframe(lovable_url, height=None, scrolling=True)
