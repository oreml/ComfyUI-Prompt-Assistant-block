<div align="center">

<h1 align="center">ComfyUI Prompt Assistant✨提示詞小助手V2.0</h1>

<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant">
<a href="https://space.bilibili.com/520680644"><img alt="bilibili" src="https://img.shields.io/badge/詳細視頻教程-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://data.xflow.cc/wechat.png"><img alt="weChat" src="https://img.shields.io/badge/歡迎加入交流群-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy"><img alt="bug" src="https://img.shields.io/badge/Bug-反饋-orange"></a>

</div>

> **📌 專案說明**  
> 本專案是基於 [ComfyUI-Prompt-Assistant](https://github.com/yawiii/ComfyUI-Prompt-Assistant) 的分支版本，保留了原專案的核心功能並進行了客製化修改。

* **Google 翻譯集成**：新增 Google 翻譯作為默認首選翻譯服務
  - 優先使用 Google Cloud Translation API（需配置 API Key）
  - 未配置 API Key 時自動使用 googletrans 免費庫作為備選方案
  - 支持長文本分段翻譯，自動處理中斷和進度顯示

> 支持調用雲端大模型API、本地Ollama大模型。實現提示詞、Markdown節點、節點文檔翻譯；提示詞優化、圖像反推和視頻反推；常用標籤收藏、歷史記錄等功能。是一個全能all in one的提示詞插件！


## **📣更新**

<details open>


</details>


## **✨ 功能介紹**
#### 💡提示詞優化+翻譯

`支持預設多套提示詞優化規則（如擴寫、qwen-edit指令優化，kontext指令優化並翻譯等`

`無需設置目標語言，自動中英互譯，自帶翻譯緩存功能，避免重複翻譯導致原文偏差`

`✨ 翻譯服務：默認使用 Google 翻譯（優先 Google Cloud API，無 API Key 時自動使用 googletrans 免費庫），也支持百度翻譯和 LLM 翻譯`

![翻譯擴寫](https://github.com/user-attachments/assets/a37b715e-ecfd-47d6-a4b8-a0b1e6bb9fcd) 


#### 🖼圖像反推

`在圖像節點上快速實現將圖片反推成提示詞，支持（中/英），支持多種反推風格（如自然語言、Tag風格...）`

![反推](https://github.com/user-attachments/assets/3713ddc5-4e2e-4412-88ee-077d86f21b99)


#### 🔖標籤、短語預設與收藏

`可將常用標籤、短語、Lora觸發詞收集，快速插入。標籤可收藏、自定義、排序、並且支持多套標籤切換。`

![標籤功能](https://github.com/user-attachments/assets/944173be-8167-42eb-93d9-e0c05256ccf8)


#### 🕐歷史、撤銷、重做

`可以按句為單位記錄（輸入框失焦觸發記錄），撤銷和重做提示詞，支持跨節點查看提示詞歷史記錄。`

![歷史](https://github.com/user-attachments/assets/85868b9e-1bf5-4789-9a71-97af80ef2bc8)


#### 📜Markdown和節點文檔翻譯

`支持翻譯note節點和Markdown節點，並保持格式`

![markdown](https://github.com/user-attachments/assets/c2ac1266-f8c1-4b27-ba41-13c5b5e5e689)

`支持翻譯英文節點文檔（beta：僅在英文節點才會出現翻譯按鈕）`

![nodedoc](https://github.com/user-attachments/assets/32c9a712-20c3-4b5e-b331-bfb885b7b5d4)



### 📒節點介紹
節點分類`✨Prompt Assistant`

#### **🔹翻譯節點**
`✨Prompt Assistant → 提示詞翻譯`

<img width="1700" height="700" alt="翻譯節點" src="https://github.com/user-attachments/assets/9dbc9fc9-1b91-43b6-822e-d598b2c8168f" />


#### **🔹提示詞優化節點**
`✨Prompt Assistant → 提示詞優化`

<img width="1700" height="911" alt="擴寫節點" src="https://github.com/user-attachments/assets/ea821506-d684-4526-9119-621bb0467ddf" />


#### **🔹圖像反推節點**
`✨Prompt Assistant → 圖像反推提示詞`

`可以反推圖像、結合視覺模型優化圖像編輯指令`

<img width="1700" height="800" alt="圖像反推節點" src="https://github.com/user-attachments/assets/8ff3ac96-724a-48d0-8e15-23fe0b28bec1" />

<img width="1700" height="800" alt="編輯模型配合視覺理解" src="https://github.com/user-attachments/assets/a95dc0f4-1d46-438f-a242-4087f6e8361a" />




#### **🔹視頻反推節點**
`✨Prompt Assistant → 視頻反推提示詞`

<img width="1700" height="1080" alt="視頻反推節點" src="https://github.com/user-attachments/assets/0143096b-24d5-4308-82ff-e0a99144db0b" />
<img width="1700" height="1102" alt="選取幀工具" src="https://github.com/user-attachments/assets/96c2bd08-b26c-4df1-b32c-be8e20328c97" />



> 💡在任意節點輸入框中輸入[R],在節點輸入和參數沒有發生變化的情況下，每次都被執行（類似隨機種子）
>
> 

## **📦 安裝方法**

### ⚠️舊版本遷移注意事項

`如果您安裝過提示詞小助手2.0之前的版本，請注意備份原插件目錄下的config目錄。避免api配置、自定義規則、自定義標籤數據丟失！`

如果您之前是通過**Manager**安裝則直接更新即可，如果您使用的是手動安裝，建議刪除舊的插件目錄（記得備份config目錄！！）將新的插件放入到`custom\custom_nodes`目錄，再將需要恢復的配置文件放回config目錄

#### **從ComfyUI Manager中安裝**

在Manager中輸入`Prompt Assistant`或`提示詞小助手`，點擊`Install`，選擇最新版本安裝。

<img width="1800" height="1098" alt="安裝" src="https://github.com/user-attachments/assets/167eb467-a77d-4a37-a95b-e935ca354284" />



#### **克隆代碼倉庫**


1. 導航到您的ComfyUI自定義節點文件夾:
   ```bash
   cd ComfyUI/custom_nodes
   ```

2. 克隆這個代碼倉庫:
   ```bash
   git clone <您的倉庫地址>
   ```

3. 安裝依賴（如果使用 Google 翻譯的 googletrans 備選方案）:
   ```bash
   cd ComfyUI-Prompt-Assistant-block
   pip install -r requirements.txt
   ```
   `💡 提示：如果配置了 Google Cloud Translation API Key，則無需安裝 googletrans。`

4. 重啟 ComfyUI：

#### **下載插件壓縮包**

1.  從倉庫中下載最新版本

    解壓縮到 `ComfyUI/custom_nodes` 目錄下

    `⚠️注意：建議將插件目錄名稱修改為：prompt-assistant，以符合ComfyUI規範`
<img width="600" height="276" alt="github安裝" src="https://github.com/user-attachments/assets/99783a78-6e0b-42aa-8f9e-7146ebcef5fd" />

2. 安裝依賴（如果使用 Google 翻譯的 googletrans 備選方案）:
   ```bash
   cd ComfyUI/custom_nodes/ComfyUI-Prompt-Assistant-block
   pip install -r requirements.txt
   ```
   `💡 提示：如果配置了 Google Cloud Translation API Key，則無需安裝 googletrans。`

3. 重啟 ComfyUI

### 數據自動遷移

新版本能自動將用戶的api配置、自定義規則、自定義標籤進行升級和遷移。您可以根據自己的需要，將要做遷移的文件，放置在`prompt-assistant\config`目錄下。如果不選擇遷移，重新安裝後，API配置信息，需要重新手動配置！ 可遷移文件有
新版本的小助手配置文件儲存在`ComfyUI\user\default\prompt-assistant`目錄下，

<img width="600" height="419" alt="遷移" src="https://github.com/user-attachments/assets/90b8f90f-51df-4537-b735-ae07c3cdff7f" />






## **⚙️ 配置說明**

### 配置API Key，並配置模型

<img width="1593" height="1119" alt="進入配置頁面" src="https://github.com/user-attachments/assets/ea01c0bc-fe0f-40be-991c-d7833965213a" />

<img width="1569" height="1137" alt="apI配置窗口" src="https://github.com/user-attachments/assets/9d982773-2939-480b-a691-bb89a227a9ff" />


### 服務說明

您可以需求新增服務商，或者選擇內置的服務商進行使用：

`⚠️免責聲明：本插件僅提供API調用工具，第三方服務責任與本插件無關，插件所涉用戶配置信息均存儲於本地。對於因帳號使用產生的任何問題，本插件不承擔責任！`

**Google 翻譯（機器翻譯，默認首選）**

- **優先方案**：[Google Cloud Translation API](https://cloud.google.com/translate/docs/setup)
  - 需在 Google Cloud 控制台啟用 Cloud Translation API 並創建 API Key
  - 翻譯質量優秀，穩定可靠
  - 按字符計費，有免費額度
  
- **備選方案**：googletrans 免費庫（自動啟用）
  - 當未配置 API Key 時，系統會自動使用 googletrans 庫
  - 無需 API Key，完全免費
  - 翻譯質量良好，但可能受頻率限制
  - 首次使用會自動安裝 `googletrans==4.0.0rc1` 依賴

`💡 提示：建議配置 Google Cloud Translation API Key 以獲得最佳體驗。若未配置，系統會自動使用 googletrans 作為備選，無需額外操作即可使用。`

​**百度翻譯（機器翻譯**​)：[百度通用文本翻譯申請入口](https://fanyi-api.baidu.com/product/11)

`速度快，但是翻譯質量一般。使用魔法時可能會導致無法請求每個月有免費500w額度`


**​智譜（大語言模型模型）：​**[智譜API申請入口](https://www.bigmodel.cn/)

`速度快，無限額度；注意：模型有審查，如果請求內容違規，會返回空結果。並非插件bug。最近智譜開始限制請求頻率了。`


**​xFlow-API聚合：​**[xFlow API申請入口](https://api.xflow.cc/)

`提供各類模型API聚合（如Gemini、nano Bannana、Grok、ChatGTP...），實現一個APIkey調用所有主流大模型，無需解決網絡問題；`

**其他服務商可自行添加**










