import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Smart Play Insight", layout="wide")

# Substitua pela URL do seu projeto que aparece no Lovable
# Geralmente é algo como https://[id-do-projeto].lovable.app
lovable_url = "https://smart-play-insight.lovable.app" 

st.title("Smart Play Insight Dashboard")

# Isso vai mostrar o seu projeto do Lovable dentro do Streamlit
components.iframe(lovable_url, height=800, scrolling=True)
