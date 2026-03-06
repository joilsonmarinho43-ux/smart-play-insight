import streamlit as st

# Configuração da página
st.set_page_config(page_title="Smart Play Insight", layout="wide")

# Título do App
st.title("Bem-vindo ao Smart Play Insight")

# Mensagem de integração
st.write("Esta é a base do seu projeto Streamlit integrada com o Lovable.")

# Exemplo de interação simples
nome = st.text_input("Qual é o seu nome?")
if nome:
    st.write(f"Olá, {nome}! O seu ambiente está configurado com sucesso.")
  
