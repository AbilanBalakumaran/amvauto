# Générer sans quota : ACE-Step sur un GPU gratuit

Le Space public d'ACE-Step tourne sur ZeroGPU, qui donne **cinq minutes de GPU
par jour** à un compte gratuit — deux ou trois morceaux. Ailleurs, le même
modèle a bien plus de temps : **Colab** en donne quinze à trente heures par
semaine, **Kaggle** trente. C'est le même modèle et la même qualité, pour zéro
euro.

Une fois lancé, on colle l'adresse qu'il annonce dans le champ **« Serveur de
secours (sans quota) »** du panneau musique d'amvauto. Le Space public reste
essayé en premier ; dès qu'il refuse, la génération bascule là-dessus toute
seule.

---

## Le plus simple : le carnet officiel, sur Colab

ACE-Step publie son propre carnet. Un clic, deux cellules à exécuter :

**https://colab.research.google.com/github/ace-step/ACE-Step/blob/main/colab_inference.ipynb**

1. Ouvre le lien, connecte-toi avec un compte Google.
2. **Exécution → Modifier le type d'exécution → GPU T4**.
3. Exécute la cellule **Install**. Cinq à dix minutes : elle télécharge le
   modèle, environ 3,5 Go.
4. Saute la cellule « Import Model From GDrive » — elle est facultative.
5. Exécute la cellule **Run Interface**.
6. Cherche dans la sortie la ligne :
   `Running on public URL: https://xxxxxxxx.gradio.live`
7. Copie cette adresse dans **« Serveur de secours »** d'amvauto.

Tant que l'onglet reste ouvert, tu génères sans limite.

---

## Sur Kaggle, pour trente heures par semaine

Kaggle est plus généreux, mais demande un compte vérifié par téléphone pour
autoriser l'accès à Internet.

1. **kaggle.com** → *Create* → *New Notebook*.
2. Dans le panneau de droite : **Accelerator → GPU T4 ×2**, puis
   **Internet → On**.
3. Colle ceci dans la première cellule, et exécute :

```python
!pip install --upgrade -q git+https://github.com/ace-step/ACE-Step.git
```

4. Puis, dans une seconde cellule :

```python
!acestep --port 7865 --share true --torch_compile false --cpu_offload false
```

5. Même chose : copie la ligne `Running on public URL` dans amvauto.

---

## Ce qu'il faut savoir

- **L'adresse est temporaire.** Elle vit tant que le carnet tourne, et Gradio la
  ferme au bout de 72 heures. On la recolle à chaque session.
- **Le premier lancement est long** : cinq à dix minutes pour télécharger les
  poids du modèle. Les suivants, dans la même session, sont immédiats.
- **`--share true`, pas `--share`.** L'option attend une valeur : sans elle, la
  commande échoue et aucune adresse publique n'est créée.
- **Le carnet doit rester ouvert.** Colab coupe une session inactive au bout de
  quelques dizaines de minutes.
