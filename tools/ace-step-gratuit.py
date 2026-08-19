"""ACE-Step sur un GPU gratuit, pour amvauto.

À coller dans un carnet Kaggle ou Google Colab, dans une seule cellule, avec un
GPU activé. Il installe ACE-Step, lance son Gradio et annonce une adresse
publique — celle-là même qu'on colle dans « Mon serveur (sans quota) » du
panneau musique d'amvauto.

Pourquoi : le Space public d'ACE-Step tourne sur ZeroGPU, qui donne cinq minutes
de GPU par jour à un compte gratuit. Kaggle en donne trente heures par semaine,
Colab une quinzaine. C'est le même modèle, la même qualité, et environ cinquante
fois plus de temps de calcul — pour zéro euro.

Deux choses à savoir :

  — L'adresse est temporaire. Elle vit tant que le carnet tourne, et Gradio la
    ferme au bout de 72 heures. On la recolle à chaque session.
  — Le carnet doit avoir accès à Internet. Sur Kaggle, c'est un interrupteur
    dans le panneau de droite ; il demande un compte vérifié par téléphone.

Le premier lancement prend cinq à dix minutes : il télécharge les poids du
modèle, environ 3,5 Go.
"""

import subprocess
import sys

DEPOT = "https://github.com/ace-step/ACE-Step.git"


def executer(commande):
    print(f"$ {commande}")
    subprocess.run(commande, shell=True, check=True)


# Les dépendances d'abord. « --quiet » garde le carnet lisible ; les erreurs,
# elles, remontent quand même grâce à check=True.
executer(f"git clone --depth 1 {DEPOT} /kaggle/working/ACE-Step 2>/dev/null "
         f"|| git clone --depth 1 {DEPOT} ./ACE-Step 2>/dev/null || true")

racine = "/kaggle/working/ACE-Step"
try:
    open(f"{racine}/requirements.txt")
except OSError:
    racine = "./ACE-Step"

executer(f"{sys.executable} -m pip install --quiet -r {racine}/requirements.txt")
executer(f"{sys.executable} -m pip install --quiet --upgrade gradio")

# `share=True` est tout l'intérêt : sans lui, le Gradio n'écoute que la machine
# du carnet, et amvauto ne peut pas le joindre.
lancement = (
    f"cd {racine} && {sys.executable} -m acestep.gui "
    "--server_name 0.0.0.0 --port 7860 --share"
)
print("\n--- lancement, l'adresse publique apparaît ci-dessous ---")
print("--- copie la ligne « Running on public URL » dans amvauto ---\n")
executer(lancement)
